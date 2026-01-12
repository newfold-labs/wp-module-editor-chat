<?php

namespace NewfoldLabs\WP\Module\EditorChat\RestApi;

use NewfoldLabs\WP\Module\EditorChat\Permissions;
use NewfoldLabs\WP\Module\EditorChat\Services\ContextBuilder;
use NewfoldLabs\WP\Module\EditorChat\Services\OpenAIProxy;
use NewfoldLabs\WP\Module\EditorChat\Clients\RemoteApiClient;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Chat Controller
 *
 * Handles communication with the remote AI chat API
 */
class ChatController extends WP_REST_Controller {

	/**
	 * The namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'nfd-editor-chat/v1';

	/**
	 * The base path for the REST API
	 *
	 * @var string
	 */
	protected $rest_base = 'chat';

	/**
	 * Context builder instance
	 *
	 * @var ContextBuilder
	 */
	protected $context_builder;

	/**
	 * Remote API client instance
	 *
	 * @var RemoteApiClient
	 */
	protected $remote_api_client;

	/**
	 * OpenAI proxy service instance
	 *
	 * @var OpenAIProxy
	 */
	protected $openai_proxy;


	/**
	 * Constructor
	 */
	public function __construct() {
		$this->context_builder   = new ContextBuilder();
		$this->remote_api_client = new RemoteApiClient();
		$this->openai_proxy      = new OpenAIProxy();
	}

	/**
	 * Register the routes for the objects of the controller.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_message' ),
					'permission_callback' => array( $this, 'send_message_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/new',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_conversation' ),
					'permission_callback' => array( $this, 'send_message_permissions_check' ),
					'args'                => array(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/status',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'get_status' ),
					'permission_callback' => array( $this, 'send_message_permissions_check' ),
					'args'                => array(
						'message_id' => array(
							'description' => 'The message ID to check status for',
							'type'        => 'string',
							'required'    => true,
						),
					),
				),
			)
		);

		// AI streaming proxy endpoint
		register_rest_route(
			$this->namespace,
			'/ai/stream',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'stream_ai_completion' ),
					'permission_callback' => array( $this, 'send_message_permissions_check' ),
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
							'default'     => true,
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
	}

	/**
	 * Create a new conversation
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_conversation( $request ) {
		$conversation_id = $this->remote_api_client->call_remote_api(
			'/new',
			array()
		);

		if ( is_wp_error( $conversation_id ) ) {
			return $conversation_id;
		}

		$conversation_id = $conversation_id['id'];

		return new WP_REST_Response(
			array(
				'conversationId' => $conversation_id,
			),
			200
		);
	}

	/**
	 * Send a message to the chat API
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function send_message( $request ) {
		$message         = $request->get_param( 'message' );
		$context         = $request->get_param( 'context' );
		$conversation_id = $request->get_param( 'conversationId' );

		if ( empty( $conversation_id ) ) {
			return new WP_Error(
				'missing_conversation_id',
				'Conversation ID is required. Please create a conversation first.',
				array( 'status' => 400 )
			);
		}

		if ( empty( $message ) ) {
			return new WP_Error(
				'missing_message',
				'Message is required',
				array( 'status' => 400 )
			);
		}

		// Build context
		$context = $this->context_builder->build_context( $context );

		// Prepare request body for remote API
		$request_body = array(
			'message' => $message,
			'id'      => $conversation_id,
			'context' => $context,
		);

		// Send message to remote API - this will queue the job and return message_id immediately
		$response = $this->remote_api_client->call_remote_api(
			'/chat',
			$request_body
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		// The remote API now returns message_id immediately
		if ( ! isset( $response['message_id'] ) ) {
			return new WP_Error(
				'invalid_response',
				'Invalid response from chat API: message_id not found',
				array( 'status' => 500 )
			);
		}

		// Return message_id immediately with 202 status (Accepted)
		return new WP_REST_Response(
			array(
				'message_id' => $response['message_id'],
			),
			202
		);
	}

	/**
	 * Check if a request has access to send a message
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return bool|WP_Error
	 */
	public function send_message_permissions_check( $request ) {
		return Permissions::is_editor();
	}

	/**
	 * Get the query params for collections
	 *
	 * @return array
	 */
	public function get_collection_params() {
		return array(
			'message'        => array(
				'description' => 'The message to send to the chat API',
				'type'        => 'string',
				'required'    => true,
			),
			'context'        => array(
				'description' => 'The context object',
				'type'        => 'object',
				'required'    => false,
			),
			'conversationId' => array(
				'description' => 'The conversation ID',
				'type'        => 'string',
				'required'    => true,
			),
		);
	}

	/**
	 * Get the status of a chat message
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_status( $request ) {
		$message_id = $request->get_param( 'message_id' );

		if ( empty( $message_id ) ) {
			return new WP_Error(
				'missing_message_id',
				'Message ID is required',
				array( 'status' => 400 )
			);
		}

		// Call remote API status endpoint
		$response = $this->remote_api_client->call_remote_api(
			'/status',
			array(
				'message_id' => $message_id,
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		// The remote API returns status and optionally data when completed
		// Format: { "status": "received|generating|completed|failed", "data": {...} }
		return new WP_REST_Response( $response, 200 );
	}

	/**
	 * Stream AI chat completion through OpenAI proxy
	 *
	 * @param WP_REST_Request $request Full details about the request.
	 * @return WP_REST_Response|WP_Error|void Returns response for non-streaming, void for streaming
	 */
	public function stream_ai_completion( $request ) {
		// Check if OpenAI is configured
		if ( ! $this->openai_proxy->is_configured() ) {
			return new WP_Error(
				'openai_not_configured',
				'OpenAI API key is not configured. Please add OPENAI_API_KEY constant to wp-config.php',
				array( 'status' => 400 )
			);
		}

		$messages = $request->get_param( 'messages' );

		if ( empty( $messages ) || ! is_array( $messages ) ) {
			return new WP_Error(
				'missing_messages',
				'Messages array is required',
				array( 'status' => 400 )
			);
		}

		// Prepare request data
		$request_data = array(
			'model'    => $request->get_param( 'model' ) ?: 'gpt-4o-mini',
			'messages' => $this->sanitize_messages( $messages ),
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
		if ( false === $stream ) {
			// Non-streaming request
			$response = $this->openai_proxy->chat_completion( $request_data );

			if ( is_wp_error( $response ) ) {
				return $response;
			}

			return new WP_REST_Response( $response, 200 );
		}

		// Streaming request - output directly and exit
		$this->openai_proxy->stream_chat_completion( $request_data );
		exit;
	}

	/**
	 * Sanitize messages array for OpenAI API
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
