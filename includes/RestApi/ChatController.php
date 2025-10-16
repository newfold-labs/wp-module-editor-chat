<?php

namespace NewfoldLabs\WP\Module\EditorChat\RestApi;

use NewfoldLabs\WP\Module\EditorChat\Permissions;
use NewfoldLabs\WP\Module\Data\HiiveConnection;

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
	 * The production base URL.
	 *
	 * @var string
	 */
	protected static $production_base_url = 'https://patterns.hiive.cloud/api/v1/editorchat';

	/**
	 * The local base URL.
	 *
	 * @var string
	 */
	protected static $local_base_url = 'https://localhost:8888/api/v1/editorchat';

	/**
	 * Get the local base URL.
	 *
	 * @return string
	 */
	protected static function get_local_base_url() {
		return defined( 'NFD_WB_LOCAL_BASE_URL' ) ? NFD_WB_LOCAL_BASE_URL . '/api/v1/editorchat' : self::$local_base_url;
	}

	/**
	 * Get the production base URL.
	 *
	 * @return string
	 */
	protected static function get_production_base_url() {
		return defined( 'NFD_WB_PRODUCTION_BASE_URL' ) ? NFD_WB_PRODUCTION_BASE_URL . '/api/v1/editorchat' : self::$production_base_url;
	}

	/**
	 * Get the remote API URL based on environment
	 *
	 * @return string
	 */
	protected function get_remote_api_url(): string {
		if ( defined( 'NFD_DATA_WB_DEV_MODE' ) && constant( 'NFD_DATA_WB_DEV_MODE' ) ) {
			return self::get_local_base_url();
		}

		return self::get_production_base_url();
	}

	/**
	 * Register the routes
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_message' ),
					'permission_callback' => array( $this, 'check_permission' ),
					'args'                => array(
						'message'        => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
							'description'       => 'The user message to send',
						),
						'conversationId' => array(
							'required'    => false,
							'type'        => 'string',
							'description' => 'The conversation ID (optional for first message)',
						),
					),
				),
			)
		);
	}

	/**
	 * Check if user has permission to use the chat
	 *
	 * @return bool
	 */
	public function check_permission() {
		return Permissions::is_editor();
	}

	/**
	 * Send a message to the AI chat API
	 *
	 * @param WP_REST_Request $request The request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function send_message( WP_REST_Request $request ) {
		$message         = $request->get_param( 'message' );
		$conversation_id = $request->get_param( 'conversationId' );
		$context         = $request->get_param( 'context' );

		// Create new conversation if no ID provided
		if ( empty( $conversation_id ) ) {
			$conversation_result = $this->create_new_conversation();

			if ( is_wp_error( $conversation_result ) ) {
				return $conversation_result;
			}

			$conversation_id = $conversation_result['id'];
		}

		// Build context
		$context = $this->build_context( $context );

		// Send message to remote API
		$response = $this->call_remote_api(
			'/chat',
			array(
				'id'      => $conversation_id,
				'message' => $message,
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
			'response'       => $response, // Include full response for debugging/future use
		);

		return new WP_REST_Response( $formatted_response, 200 );
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

	/**
	 * Create a new conversation
	 *
	 * @return array|WP_Error
	 */
	private function create_new_conversation() {

		$response = wp_remote_post(
			$this->get_remote_api_url() . '/new',
			array(
				'headers'   => array(
					'Content-Type'  => 'application/json',
					'Authorization' => 'Bearer ' . HiiveConnection::get_auth_token(),
				),
				'timeout'   => 30,
				'sslverify' => $this->should_verify_ssl(),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'api_error',
				'Failed to create new conversation',
				array( 'status' => 500 )
			);
		}

		$body = wp_remote_retrieve_body( $response );
		$data = json_decode( $body, true );

		if ( empty( $data['id'] ) ) {
			return new WP_Error(
				'api_error',
				'Invalid response from API',
				array( 'status' => 500 )
			);
		}

		return $data;
	}

	/**
	 * Call the remote API
	 *
	 * @param string $endpoint The API endpoint.
	 * @param array  $body     The request body.
	 * @return array|WP_Error
	 */
	private function call_remote_api( $endpoint, $body ) {
		$response = wp_remote_post(
			$this->get_remote_api_url() . $endpoint,
			array(
				'headers'   => array(
					'Content-Type'  => 'application/json',
					'Authorization' => 'Bearer ' . HiiveConnection::get_auth_token(),
				),
				'body'      => wp_json_encode( $body ),
				'timeout'   => 30,
				'sslverify' => $this->should_verify_ssl(),
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'api_error',
				'Failed to communicate with AI service',
				array( 'status' => 500 )
			);
		}

		$response_code = wp_remote_retrieve_response_code( $response );
		$response_body = wp_remote_retrieve_body( $response );
		$data          = json_decode( $response_body, true );

		if ( 200 !== $response_code ) {
			return new WP_Error(
				'api_error',
				'API returned error: ' . ( $data['message'] ?? 'Unknown error' ),
				array( 'status' => $response_code )
			);
		}

		return $data;
	}

	/**
	 * Build the context object
	 *
	 * @param array $context The context array.
	 * @return array The context array.
	 */
	private function build_context( $context ) {
		global $post;

		$onboarding_prompt = get_option( 'nfd_module_onboarding_state_input', '' );

		$context = wp_parse_args(
			$context,
			array(
				'pageId'           => $context['pageId'] ?? '',
				'pageContent'      => $context['pageContent'] ?? '',
				'selectedBlock'    => $context['selectedBlock'] ?? '',
				'siteTitle'        => get_bloginfo( 'name' ),
				'locale'           => get_locale(),
				'classification'   => get_option( 'nfd-ai-site-gen-siteclassification', '' ),
				'onboardingPrompt' => $onboarding_prompt['prompt'] ?? get_bloginfo( 'description' ),
				'siteType'         => $onboarding_prompt['siteType'] ?? '',
				'themeJson'        => $this->get_theme_json(),
				'globalStyles'     => $this->get_global_styles(),
			)
		);

		return $context;
	}

	/**
	 * Get theme.json data
	 *
	 * @return array
	 */
	private function get_theme_json() {
		if ( ! function_exists( 'wp_get_global_settings' ) ) {
			return array();
		}

		return \wp_get_global_settings();
	}

	/**
	 * Get global styles
	 *
	 * @return array
	 */
	private function get_global_styles() {
		$global_styles_id = \WP_Theme_JSON_Resolver::get_user_global_styles_post_id();

		if ( ! $global_styles_id ) {
			return array();
		}

		$global_styles = \get_post( $global_styles_id );

		if ( ! $global_styles ) {
			return array();
		}

		$styles = json_decode( $global_styles->post_content, true );

		return $styles ?? array();
	}

	/**
	 * Determine if SSL should be verified
	 *
	 * @return bool
	 */
	private function should_verify_ssl() {
		// In development environments, disable SSL verification
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			return false;
		}

		// Check if we're on a local development environment
		$site_url = get_site_url();
		if ( strpos( $site_url, 'localhost' ) !== false ||
			strpos( $site_url, '127.0.0.1' ) !== false ||
			strpos( $site_url, '.test' ) !== false ||
			strpos( $site_url, '.local' ) !== false ) {
			return false;
		}

		// For production, always verify SSL
		return true;
	}
}
