<?php

namespace NewfoldLabs\WP\Module\EditorChat\Clients;

use NewfoldLabs\WP\Module\Data\HiiveConnection;

/**
 * Remote API Client
 *
 * Handles communication with the remote AI chat API
 */
class RemoteApiClient {

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
	public function get_remote_api_url(): string {
		if ( defined( 'NFD_DATA_WB_DEV_MODE' ) && constant( 'NFD_DATA_WB_DEV_MODE' ) ) {
			return self::get_local_base_url();
		}

		return self::get_production_base_url();
	}

	/**
	 * Call the remote API
	 *
	 * @param string $endpoint The API endpoint.
	 * @param array  $body     The request body.
	 * @return array|WP_Error
	 */
	public function call_remote_api( $endpoint, $body ) {
		$response = \wp_remote_post(
			$this->get_remote_api_url() . $endpoint,
			array(
				'headers'   => array(
					'Content-Type'  => 'application/json',
					'Authorization' => 'Bearer ' . HiiveConnection::get_auth_token(),
				),
				'body'      => \wp_json_encode( $body ),
				'timeout'   => 60,
				'sslverify' => $this->should_verify_ssl(),
			)
		);

		if ( \is_wp_error( $response ) ) {
			return new \WP_Error(
				'api_error',
				'Failed to communicate with AI service',
				array( 'status' => 500 )
			);
		}

		$response_code = \wp_remote_retrieve_response_code( $response );
		$response_body = \wp_remote_retrieve_body( $response );
		$data          = json_decode( $response_body, true );

		if ( 200 !== $response_code && 202 !== $response_code ) {
			return new \WP_Error(
				'api_error',
				'API returned error: ' . ( $data['message'] ?? 'Unknown error' ),
				array( 'status' => $response_code )
			);
		}

		return $data;
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
