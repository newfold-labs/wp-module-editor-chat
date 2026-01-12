<?php
/**
 * OpenAI Proxy Service
 *
 * Handles proxying requests to OpenAI API or Cloudflare AI Gateway.
 * Supports both streaming and non-streaming requests.
 *
 * @package NewfoldLabs\WP\Module\EditorChat\Services
 */

namespace NewfoldLabs\WP\Module\EditorChat\Services;

use WP_Error;

/**
 * OpenAI Proxy class
 */
class OpenAIProxy {

	/**
	 * OpenAI API base URL
	 *
	 * @var string
	 */
	const OPENAI_API_URL = 'https://api.openai.com/v1';

	/**
	 * Default model to use
	 *
	 * @var string
	 */
	const DEFAULT_MODEL = 'gpt-4o-mini';

	/**
	 * Get the OpenAI API key from options or wp-config.php constant
	 *
	 * @return string|null API key or null if not defined
	 */
	public function get_openai_api_key() {
		// First check WordPress option
		$key = get_option( 'nfd_editor_chat_openai_api_key', '' );
		if ( ! empty( $key ) ) {
			return $key;
		}

		// Fall back to wp-config.php constant
		if ( defined( 'OPENAI_API_KEY' ) && ! empty( OPENAI_API_KEY ) ) {
			return OPENAI_API_KEY;
		}

		return null;
	}

	/**
	 * Get Cloudflare AI Gateway URL from wp-config.php or options
	 *
	 * @return string|null Gateway URL or null if not configured
	 */
	public function get_cloudflare_gateway_url() {
		// First check wp-config.php constant
		if ( defined( 'CF_AI_GATEWAY_URL' ) && ! empty( CF_AI_GATEWAY_URL ) ) {
			return CF_AI_GATEWAY_URL;
		}

		// Fall back to WordPress option
		return get_option( 'nfd_editor_chat_cloudflare_gateway_url', '' ) ?: null;
	}

	/**
	 * Get Cloudflare token from wp-config.php or options
	 *
	 * @return string|null Token or null if not configured
	 */
	public function get_cloudflare_token() {
		// First check wp-config.php constant
		if ( defined( 'CF_AI_GATEWAY_TOKEN' ) && ! empty( CF_AI_GATEWAY_TOKEN ) ) {
			return CF_AI_GATEWAY_TOKEN;
		}

		// Fall back to WordPress option
		return get_option( 'nfd_editor_chat_cloudflare_token', '' ) ?: null;
	}

	/**
	 * Check if AI is configured (either OpenAI or Cloudflare)
	 *
	 * @return bool True if configured
	 */
	public function is_configured() {
		$cloudflare_url   = $this->get_cloudflare_gateway_url();
		$cloudflare_token = $this->get_cloudflare_token();
		$openai_key       = $this->get_openai_api_key();

		// Check Cloudflare configuration first
		if ( ! empty( $cloudflare_url ) && ! empty( $cloudflare_token ) ) {
			return true;
		}

		// Fall back to OpenAI
		return ! empty( $openai_key );
	}

	/**
	 * Get the API configuration (URL and headers)
	 *
	 * @return array|WP_Error Configuration array with 'url' and 'headers' or WP_Error
	 */
	public function get_api_config() {
		$cloudflare_url   = $this->get_cloudflare_gateway_url();
		$cloudflare_token = $this->get_cloudflare_token();
		$openai_key       = $this->get_openai_api_key();

		// Prefer Cloudflare AI Gateway if configured
		if ( ! empty( $cloudflare_url ) && ! empty( $cloudflare_token ) ) {
			return array(
				'url'     => rtrim( $cloudflare_url, '/' ) . '/chat/completions',
				'headers' => array(
					'cf-aig-authorization' => 'Bearer ' . $cloudflare_token,
					'Content-Type'         => 'application/json',
				),
			);
		}

		// Fall back to direct OpenAI API
		if ( ! empty( $openai_key ) ) {
			return array(
				'url'     => self::OPENAI_API_URL . '/chat/completions',
				'headers' => array(
					'Authorization' => 'Bearer ' . $openai_key,
					'Content-Type'  => 'application/json',
				),
			);
		}

		return new WP_Error(
			'missing_ai_config',
			'AI configuration is missing. Please configure Cloudflare AI Gateway or OpenAI API key in settings.',
			array( 'status' => 400 )
		);
	}

	/**
	 * Fix empty arrays that should be empty objects for JSON Schema compliance
	 *
	 * PHP's json_decode converts {} to [] when using associative arrays.
	 * This breaks OpenAI's JSON Schema validation which expects objects.
	 *
	 * @param array $tools The tools array to fix.
	 * @return array Fixed tools array with proper object types.
	 */
	private function fix_tools_schema( array $tools ): array {
		foreach ( $tools as &$tool ) {
			if ( isset( $tool['function']['parameters'] ) ) {
				$params = &$tool['function']['parameters'];

				// Ensure parameters is an object, not an empty array
				if ( empty( $params ) || ( is_array( $params ) && array_keys( $params ) === range( 0, count( $params ) - 1 ) && count( $params ) === 0 ) ) {
					$params = (object) array(
						'type'       => 'object',
						'properties' => (object) array(),
					);
				} else {
					// Ensure type is set
					if ( ! isset( $params['type'] ) ) {
						$params['type'] = 'object';
					}

					// Ensure properties is an object, not an empty array
					if ( ! isset( $params['properties'] ) || ( is_array( $params['properties'] ) && empty( $params['properties'] ) ) ) {
						$params['properties'] = (object) array();
					}
				}
			}
		}

		return $tools;
	}

	/**
	 * Proxy a chat completion request
	 *
	 * @param array $request_data Request data including messages, tools, etc.
	 * @return array|WP_Error Response data or error
	 */
	public function proxy_request( array $request_data ) {
		$config = $this->get_api_config();

		if ( is_wp_error( $config ) ) {
			return $config;
		}

		// Prepare the request body
		$body = array(
			'model'    => $request_data['model'] ?? self::DEFAULT_MODEL,
			'messages' => $request_data['messages'] ?? array(),
			'stream'   => false,
		);

		// Add optional parameters - fix tools schema to prevent empty array issues
		if ( ! empty( $request_data['tools'] ) ) {
			$body['tools'] = $this->fix_tools_schema( $request_data['tools'] );
		}

		if ( isset( $request_data['tool_choice'] ) ) {
			$body['tool_choice'] = $request_data['tool_choice'];
		}

		if ( isset( $request_data['max_tokens'] ) ) {
			$body['max_tokens'] = (int) $request_data['max_tokens'];
		}

		if ( isset( $request_data['temperature'] ) ) {
			$body['temperature'] = (float) $request_data['temperature'];
		}

		$response = wp_remote_post(
			$config['url'],
			array(
				'headers'     => $config['headers'],
				'body'        => wp_json_encode( $body ),
				'timeout'     => 60,
				'data_format' => 'body',
			)
		);

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'api_request_failed',
				$response->get_error_message(),
				array( 'status' => 500 )
			);
		}

		$response_code = wp_remote_retrieve_response_code( $response );
		$response_body = wp_remote_retrieve_body( $response );
		$data          = json_decode( $response_body, true );

		if ( 200 !== $response_code ) {
			$error_message = $data['error']['message'] ?? 'AI API request failed';
			return new WP_Error(
				'api_error',
				$error_message,
				array( 'status' => $response_code )
			);
		}

		return $data;
	}

	/**
	 * Stream a chat completion request
	 *
	 * This outputs SSE events directly to the response.
	 *
	 * @param array $request_data Request data including messages, tools, etc.
	 * @return void|WP_Error Outputs stream or returns error
	 */
	public function stream_request( array $request_data ) {
		$config = $this->get_api_config();

		if ( is_wp_error( $config ) ) {
			$this->send_error_event( $config->get_error_message() );
			return;
		}

		// Prepare the request body
		$body = array(
			'model'    => $request_data['model'] ?? self::DEFAULT_MODEL,
			'messages' => $request_data['messages'] ?? array(),
			'stream'   => true,
		);

		// Add optional parameters - fix tools schema to prevent empty array issues
		if ( ! empty( $request_data['tools'] ) ) {
			$body['tools'] = $this->fix_tools_schema( $request_data['tools'] );
		}

		if ( isset( $request_data['tool_choice'] ) ) {
			$body['tool_choice'] = $request_data['tool_choice'];
		}

		if ( isset( $request_data['max_tokens'] ) ) {
			$body['max_tokens'] = (int) $request_data['max_tokens'];
		}

		if ( isset( $request_data['temperature'] ) ) {
			$body['temperature'] = (float) $request_data['temperature'];
		}

		// Set up streaming headers
		$this->setup_streaming_headers();

		// Make the streaming request using cURL
		$this->make_streaming_request( $config, $body );
	}

	/**
	 * Set up headers for streaming response
	 *
	 * @return void
	 */
	private function setup_streaming_headers() {
		// Disable output buffering
		while ( ob_get_level() > 0 ) {
			ob_end_flush();
		}

		// Set SSE headers
		header( 'Content-Type: text/event-stream' );
		header( 'Cache-Control: no-cache' );
		header( 'Connection: keep-alive' );
		header( 'X-Accel-Buffering: no' ); // Disable nginx buffering

		// Flush headers
		if ( function_exists( 'fastcgi_finish_request' ) ) {
			// Don't call this - it would end the request
		}
	}

	/**
	 * Make a streaming request to the AI API
	 *
	 * @param array $config API configuration.
	 * @param array $body   Request body.
	 * @return void
	 */
	private function make_streaming_request( array $config, array $body ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_init
		$ch = curl_init( $config['url'] );

		// Build headers array for cURL
		$curl_headers = array();
		foreach ( $config['headers'] as $key => $value ) {
			$curl_headers[] = "{$key}: {$value}";
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt_array
		curl_setopt_array(
			$ch,
			array(
				CURLOPT_POST           => true,
				CURLOPT_POSTFIELDS     => wp_json_encode( $body ),
				CURLOPT_HTTPHEADER     => $curl_headers,
				CURLOPT_RETURNTRANSFER => false,
				CURLOPT_TIMEOUT        => 120,
				CURLOPT_WRITEFUNCTION  => array( $this, 'handle_stream_chunk' ),
			)
		);

		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_exec
		$result = curl_exec( $ch );

		if ( false === $result ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_error
			$error = curl_error( $ch );
			$this->send_error_event( 'cURL error: ' . $error );
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_close
		curl_close( $ch );

		// Send final done event
		echo "data: [DONE]\n\n";

		if ( ob_get_level() > 0 ) {
			ob_flush();
		}
		flush();
	}

	/**
	 * Handle streaming chunk from cURL
	 *
	 * @param resource $ch   cURL handle.
	 * @param string   $data Chunk data.
	 * @return int Number of bytes handled
	 */
	public function handle_stream_chunk( $ch, $data ) {
		// Forward the data as-is (it's already in SSE format from OpenAI)
		echo $data;

		if ( ob_get_level() > 0 ) {
			ob_flush();
		}
		flush();

		return strlen( $data );
	}

	/**
	 * Send an error event via SSE
	 *
	 * @param string $message Error message.
	 * @return void
	 */
	private function send_error_event( string $message ) {
		$error_data = wp_json_encode(
			array(
				'error' => array(
					'message' => $message,
				),
			)
		);

		echo "data: {$error_data}\n\n";
		echo "data: [DONE]\n\n";

		if ( ob_get_level() > 0 ) {
			ob_flush();
		}
		flush();
	}

	/**
	 * Get masked settings for frontend display
	 *
	 * @return array Settings with sensitive values masked
	 */
	public function get_masked_settings() {
		return array(
			'openai_api_key'         => ! empty( $this->get_openai_api_key() ) ? '***' : '',
			'cloudflare_gateway_url' => $this->get_cloudflare_gateway_url() ?: '',
			'cloudflare_token'       => ! empty( $this->get_cloudflare_token() ) ? '***' : '',
			'is_configured'          => $this->is_configured(),
		);
	}
}
