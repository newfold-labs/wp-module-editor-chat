<?php
/**
 * OpenAI Proxy Service
 *
 * Handles communication with OpenAI API including streaming responses.
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
	const API_BASE_URL = 'https://api.openai.com/v1';

	/**
	 * Default model to use
	 *
	 * @var string
	 */
	const DEFAULT_MODEL = 'gpt-4o-mini';

	/**
	 * Get the OpenAI API key from wp-config.php constant
	 *
	 * @return string|null API key or null if not defined
	 */
	public function get_api_key() {
		if ( defined( 'OPENAI_API_KEY' ) && ! empty( OPENAI_API_KEY ) ) {
			return OPENAI_API_KEY;
		}
		return null;
	}

	/**
	 * Check if OpenAI is configured
	 *
	 * @return bool True if API key is available
	 */
	public function is_configured() {
		return ! empty( $this->get_api_key() );
	}

	/**
	 * Send a streaming chat completion request
	 *
	 * @param array $request_data Request data including messages, tools, etc.
	 * @return void Outputs SSE stream directly
	 */
	public function stream_chat_completion( array $request_data ) {
		$api_key = $this->get_api_key();

		if ( empty( $api_key ) ) {
			$this->send_error_event( 'OpenAI API key is not configured. Please add OPENAI_API_KEY constant to wp-config.php' );
			return;
		}

		// Prepare the request body
		$body = array(
			'model'    => $request_data['model'] ?? self::DEFAULT_MODEL,
			'messages' => $request_data['messages'] ?? array(),
			'stream'   => true,
		);

		// Add optional parameters
		if ( ! empty( $request_data['tools'] ) ) {
			$body['tools'] = $request_data['tools'];
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

		// Make the streaming request
		$this->make_streaming_request( $api_key, $body );
	}

	/**
	 * Send a non-streaming chat completion request
	 *
	 * @param array $request_data Request data including messages, tools, etc.
	 * @return array|WP_Error Response data or error
	 */
	public function chat_completion( array $request_data ) {
		$api_key = $this->get_api_key();

		if ( empty( $api_key ) ) {
			return new WP_Error(
				'missing_api_key',
				'OpenAI API key is not configured. Please add OPENAI_API_KEY constant to wp-config.php',
				array( 'status' => 400 )
			);
		}

		// Prepare the request body
		$body = array(
			'model'    => $request_data['model'] ?? self::DEFAULT_MODEL,
			'messages' => $request_data['messages'] ?? array(),
			'stream'   => false,
		);

		// Add optional parameters
		if ( ! empty( $request_data['tools'] ) ) {
			$body['tools'] = $request_data['tools'];
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
			self::API_BASE_URL . '/chat/completions',
			array(
				'headers'     => array(
					'Authorization' => 'Bearer ' . $api_key,
					'Content-Type'  => 'application/json',
				),
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
			$error_message = $data['error']['message'] ?? 'OpenAI API request failed';
			return new WP_Error(
				'api_error',
				$error_message,
				array( 'status' => $response_code )
			);
		}

		return $data;
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
	 * Make a streaming request to OpenAI
	 *
	 * @param string $api_key API key.
	 * @param array  $body    Request body.
	 * @return void
	 */
	private function make_streaming_request( string $api_key, array $body ) {
		$url = self::API_BASE_URL . '/chat/completions';

		// Use cURL for streaming
		$ch = curl_init( $url );

		curl_setopt_array(
			$ch,
			array(
				CURLOPT_POST           => true,
				CURLOPT_POSTFIELDS     => wp_json_encode( $body ),
				CURLOPT_HTTPHEADER     => array(
					'Authorization: Bearer ' . $api_key,
					'Content-Type: application/json',
				),
				CURLOPT_RETURNTRANSFER => false,
				CURLOPT_TIMEOUT        => 120,
				CURLOPT_WRITEFUNCTION  => array( $this, 'handle_stream_chunk' ),
			)
		);

		$result = curl_exec( $ch );

		if ( false === $result ) {
			$error = curl_error( $ch );
			$this->send_error_event( 'cURL error: ' . $error );
		}

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
}
