<?php

namespace NewfoldLabs\WP\Module\EditorChat\RestApi;

use NewfoldLabs\WP\Module\EditorChat\Permissions;
use NewfoldLabs\WP\Module\EditorChat\Services\OpenAIProxy;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Chat Controller
 *
 * Handles AI chat completions via streaming proxy to cloud-patterns
 */
class ChatController extends WP_REST_Controller {

	/**
	 * The namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'nfd-editor-chat/v1';

	/**
	 * OpenAI proxy instance
	 *
	 * @var OpenAIProxy
	 */
	protected $openai_proxy;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->openai_proxy = new OpenAIProxy();
	}

	/**
	 * Register the routes for the objects of the controller.
	 */
	public function register_routes() {
		// AI proxy endpoint for streaming chat completions
		register_rest_route(
			$this->namespace,
			'/ai/chat/completions',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'proxy_ai_request' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'model'       => array(
							'description' => 'The AI model to use',
							'type'        => 'string',
							'required'    => false,
							'default'     => 'gpt-4o-mini',
						),
						'messages'    => array(
							'description' => 'The chat messages array',
							'type'        => 'array',
							'required'    => true,
						),
						'tools'       => array(
							'description' => 'Available tools/functions',
							'type'        => 'array',
							'required'    => false,
						),
						'tool_choice' => array(
							'description' => 'Tool choice strategy',
							'required'    => false,
						),
						'stream'      => array(
							'description' => 'Whether to stream the response',
							'type'        => 'boolean',
							'required'    => false,
							'default'     => false,
						),
						'max_tokens'  => array(
							'description' => 'Maximum tokens in response',
							'type'        => 'integer',
							'required'    => false,
						),
						'temperature' => array(
							'description' => 'Temperature for response randomness',
							'type'        => 'number',
							'required'    => false,
						),
					),
				),
			)
		);

		// AI settings endpoint
		register_rest_route(
			$this->namespace,
			'/ai/settings',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_ai_settings' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);
	}

	/**
	 * Check if a request has access
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return bool|WP_Error
	 */
	public function permissions_check( $request ) {
		return Permissions::is_editor();
	}

	/**
	 * Proxy AI requests to cloud-patterns (which forwards to Cloudflare AI Gateway)
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error|void
	 */
	public function proxy_ai_request( $request ) {
		// Check if AI is configured
		if ( ! $this->openai_proxy->is_configured() ) {
			return new WP_Error(
				'ai_not_configured',
				'AI is not configured. Please configure Cloudflare AI Gateway or OpenAI API key.',
				array( 'status' => 400 )
			);
		}

		// Prepare request data
		$request_data = array(
			'model'    => $request->get_param( 'model' ) ?: 'gpt-4o-mini',
			'messages' => $this->sanitize_messages( $request->get_param( 'messages' ) ),
		);

		// Add optional parameters
		$tools = $request->get_param( 'tools' );
		if ( ! empty( $tools ) ) {
			$request_data['tools'] = $tools;
		}

		$tool_choice = $request->get_param( 'tool_choice' );
		if ( null !== $tool_choice ) {
			$request_data['tool_choice'] = $tool_choice;
		}

		$max_tokens = $request->get_param( 'max_tokens' );
		if ( null !== $max_tokens ) {
			$request_data['max_tokens'] = $max_tokens;
		}

		$temperature = $request->get_param( 'temperature' );
		if ( null !== $temperature ) {
			$request_data['temperature'] = $temperature;
		}

		$stream = $request->get_param( 'stream' );

		// Handle streaming vs non-streaming
		if ( $stream ) {
			// Streaming request - output directly and exit
			$this->openai_proxy->stream_request( $request_data );
			exit;
		}

		// Non-streaming request
		$response = $this->openai_proxy->proxy_request( $request_data );

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		return new WP_REST_Response( $response, 200 );
	}

	/**
	 * Get AI settings (masked for frontend)
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response
	 */
	public function get_ai_settings( $request ) {
		return new WP_REST_Response(
			array(
				'success'  => true,
				'settings' => $this->openai_proxy->get_masked_settings(),
			),
			200
		);
	}

	/**
	 * Sanitize messages array for AI API
	 *
	 * @param array $messages Raw messages array.
	 * @return array Sanitized messages
	 */
	private function sanitize_messages( array $messages ) {
		$sanitized = array();

		foreach ( $messages as $message ) {
			if ( ! isset( $message['role'] ) ) {
				continue;
			}

			$sanitized_message = array(
				'role' => sanitize_text_field( $message['role'] ),
			);

			// Handle content (can be string or null for tool calls)
			if ( isset( $message['content'] ) ) {
				$sanitized_message['content'] = wp_kses_post( $message['content'] );
			}

			// Handle tool calls from assistant
			if ( ! empty( $message['tool_calls'] ) && is_array( $message['tool_calls'] ) ) {
				$sanitized_message['tool_calls'] = $message['tool_calls'];
			}

			// Handle tool response
			if ( isset( $message['tool_call_id'] ) ) {
				$sanitized_message['tool_call_id'] = sanitize_text_field( $message['tool_call_id'] );
			}

			$sanitized[] = $sanitized_message;
		}

		return $sanitized;
	}
}
