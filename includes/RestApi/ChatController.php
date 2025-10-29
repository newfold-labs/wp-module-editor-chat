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

		// Send message to remote API
		$response = $this->remote_api_client->call_remote_api(
			'/chat',
			array(
				'message' => $message,
				'id'      => $conversation_id,
				'context' => $context,
			)
		);

		if ( is_wp_error( $response ) ) {
			return $response;
		}

		// Extract the assistant's message from the nested response structure
		$assistant_message = $this->extract_assistant_message( $response );

		// Format the response for the frontend
		$formatted_response = array(
			'conversationId' => $conversation_id,
			'message'        => $assistant_message,
		);

		// Pass actions directly to frontend
		if ( isset( $response['actions'] ) && is_array( $response['actions'] ) ) {
			$formatted_response['actions'] = $response['actions'];
		}

		if ( defined( 'NFD_DATA_WB_DEV_MODE' ) && constant( 'NFD_DATA_WB_DEV_MODE' ) ) {
			$formatted_response['debug_context'] = $context;
		}

		return new WP_REST_Response( $formatted_response, 200 );
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
