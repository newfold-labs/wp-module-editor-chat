<?php

namespace NewfoldLabs\WP\Module\EditorChat\RestApi;

use NewfoldLabs\WP\Module\EditorChat\Permissions;
use NewfoldLabs\WP\Module\EditorChat\Services\ContextBuilder;
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
	 * Constructor
	 */
	public function __construct() {
		$this->context_builder   = new ContextBuilder();
		$this->remote_api_client = new RemoteApiClient();
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
	 * Extract the assistant's message from the API response
	 *
	 * @param array $response The API response data.
	 * @return string The assistant's message or a fallback message.
	 */
	private function extract_assistant_message( $response ) {
		// Check for the nested structure: chat.current_message.assistant
		if ( isset( $response['chat']['current_message']['assistant'] ) ) {
			$message = $response['chat']['current_message']['assistant'];

			// Return the message if it's not null/empty
			if ( ! empty( $message ) ) {
				return $message;
			}
		}

		// Fallback: check for direct message field
		if ( isset( $response['message'] ) && ! empty( $response['message'] ) ) {
			return $response['message'];
		}

		// Fallback: check for response field
		if ( isset( $response['response'] ) && ! empty( $response['response'] ) ) {
			return $response['response'];
		}

		// Final fallback
		return __( 'I received your message, but I\'m having trouble processing it right now. Please try again.', 'wp-module-editor-chat' );
	}
}
