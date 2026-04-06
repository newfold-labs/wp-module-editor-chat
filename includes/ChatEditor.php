<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * ChatEditor main class
 *
 * Handles the registration and loading of the AI chat editor assets
 * in the WordPress block editor, and provides a config REST endpoint
 * for the CF AI Gateway Worker handshake.
 */
final class ChatEditor {
	/**
	 * Array of allowed referrers for site editor access
	 *
	 * @var array
	 */
	protected static $allowed_referrers = array(
		'nfd-editor-chat',
	);

	/**
	 * Constructor.
	 */
	public function __construct() {
		\add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_site_editor_assets' ) );
		\add_action( 'rest_api_init', array( __CLASS__, 'register_rest_routes' ) );
		\add_action( 'init', array( __CLASS__, 'load_text_domain' ), 100 );
		\add_filter( 'load_script_translation_file', array( __CLASS__, 'load_script_translation_file' ), 10, 3 );
	}

	/**
	 * Register REST API routes.
	 */
	public static function register_rest_routes() {
		\register_rest_route(
			'nfd-editor-chat/v1',
			'/config',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( __CLASS__, 'get_config' ),
				'permission_callback' => function () {
					return Permissions::is_editor();
				},
			)
		);
	}

	/**
	 * Get configuration for the editor chat frontend.
	 *
	 * Performs a server-to-server handshake with the CF Worker to exchange
	 * the Hiive auth token for a short-lived session JWT. The Hiive token
	 * never reaches the browser.
	 *
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function get_config() {
		$worker_url = defined( 'NFD_EDITOR_CHAT_WORKER_URL' )
			? \NFD_EDITOR_CHAT_WORKER_URL
			: '';

		if ( empty( $worker_url ) ) {
			return new \WP_Error(
				'worker_url_not_configured',
				__( 'Editor chat Worker URL is not configured. Set NFD_EDITOR_CHAT_WORKER_URL in wp-config.php.', 'wp-module-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		// Get Hiive auth token for server-to-server handshake
		$hiive_token = '';
		if ( class_exists( '\NewfoldLabs\WP\Module\Data\HiiveConnection' ) ) {
			$hiive_token = \NewfoldLabs\WP\Module\Data\HiiveConnection::get_auth_token();
		}

		if ( empty( $hiive_token ) ) {
			return new \WP_Error(
				'hiive_token_unavailable',
				__( 'Unable to retrieve Hiive authentication token.', 'wp-module-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		// Server-to-server handshake with Worker
		$handshake_response = \wp_remote_post(
			$worker_url . '/handshake',
			array(
				'headers' => array(
					'X-Hiive-Token' => $hiive_token,
					'Content-Type'  => 'application/json',
				),
				'body'    => \wp_json_encode(
					array(
						'site_url' => \get_site_url(),
						'brand_id' => self::get_brand_id(),
					)
				),
				'timeout' => 10,
			)
		);

		if ( \is_wp_error( $handshake_response ) ) {
			return new \WP_Error(
				'handshake_failed',
				$handshake_response->get_error_message(),
				array( 'status' => 502 )
			);
		}

		$status_code = \wp_remote_retrieve_response_code( $handshake_response );
		if ( 200 !== $status_code ) {
			return new \WP_Error(
				'handshake_failed',
				/* translators: %d: HTTP status code from the Worker handshake. */
				\sprintf( __( 'Worker handshake returned HTTP %d.', 'wp-module-editor-chat' ), $status_code ),
				array( 'status' => 502 )
			);
		}

		$data = json_decode( \wp_remote_retrieve_body( $handshake_response ), true );

		if ( empty( $data['session_token'] ) ) {
			return new \WP_Error(
				'handshake_failed',
				__( 'Worker handshake did not return a session token.', 'wp-module-editor-chat' ),
				array( 'status' => 502 )
			);
		}

		return new \WP_REST_Response(
			array(
				'worker_url'    => $worker_url,
				'session_token' => $data['session_token'],
				'expires_in'    => $data['expires_in'] ?? 3600,
			)
		);
	}

	/**
	 * Get the brand identifier for the current plugin.
	 *
	 * @return string
	 */
	private static function get_brand_id() {
		if ( defined( 'STARTER_PLUGIN_BRAND' ) ) {
			return \STARTER_PLUGIN_BRAND;
		}
		// Fallback: derive from plugin directory name
		$plugin_dir = \basename( \dirname( __DIR__, 3 ) );
		$brand_map  = array(
			'wp-plugin-bluehost'      => 'bluehost',
			'wp-plugin-hostgator'     => 'hostgator',
			'wp-plugin-web'           => 'web',
			'wp-plugin-crazy-domains' => 'crazydomains',
		);
		return $brand_map[ $plugin_dir ] ?? 'bluehost';
	}

	/**
	 * Enqueue site editor specific assets when coming from allowed referrers.
	 *
	 * @return void
	 */
	public static function enqueue_site_editor_assets() {
		global $pagenow;

		// Only proceed if we're on site-editor.php and have the right referrer
		if ( 'site-editor.php' !== $pagenow ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Referrer parameter is validated against allowed list, no data modification.
		if ( ! isset( $_GET['referrer'] ) || ! \in_array( $_GET['referrer'], self::$allowed_referrers, true ) ) {
			return;
		}

		self::register_assets();
		\add_filter( 'admin_body_class', array( __CLASS__, 'add_admin_body_class' ) );
	}

	/**
	 * Register and enqueue chat editor assets.
	 */
	public static function register_assets() {

		$asset_file = NFD_EDITOR_CHAT_BUILD_DIR . '/chat-editor.asset.php';

		if ( \is_readable( $asset_file ) ) {
			$asset = include_once $asset_file;

			\wp_register_script(
				'nfd-editor-chat',
				NFD_EDITOR_CHAT_BUILD_URL . '/chat-editor.js',
				array_merge( $asset['dependencies'], array() ),
				$asset['version'],
				true
			);

			\wp_register_style(
				'nfd-editor-chat',
				NFD_EDITOR_CHAT_BUILD_URL . '/chat-editor.css',
				array(),
				$asset['version']
			);

			\wp_localize_script(
				'nfd-editor-chat',
				'nfdEditorChat',
				array(
					'nonce'          => \wp_create_nonce( 'wp_rest' ),
					'nfdRestURL'     => \get_home_url() . '/index.php?rest_route=/nfd-editor-chat/v1',
					'mcpUrl'         => \esc_url_raw( \rest_url( 'blu/mcp' ) ),
					'configEndpoint' => \esc_url_raw( \rest_url( 'nfd-editor-chat/v1/config' ) ),
					'homeUrl'        => \esc_url( \get_home_url() ),
					'wpVer'          => \esc_html( \get_bloginfo( 'version' ) ),
					'nfdChatVersion' => \esc_html( NFD_EDITOR_CHAT_VERSION ),
					'model'          => defined( 'NFD_EDITOR_CHAT_MODEL' ) ? \NFD_EDITOR_CHAT_MODEL : 'gpt-4o-mini',
					'site'           => self::get_site_context(),
				)
			);

			\wp_set_script_translations(
				'nfd-editor-chat',
				'nfd-editor-chat',
				NFD_EDITOR_CHAT_DIR . '/languages'
			);

			\wp_enqueue_script( 'nfd-editor-chat' );
			\wp_enqueue_style( 'nfd-editor-chat' );
		}
	}

	/**
	 * Filter default WP script translations file to load the correct one
	 *
	 * @param string $file The translations file.
	 * @param string $handle Script handle.
	 * @param string $domain The strings textdomain.
	 * @return string
	 */
	public static function load_script_translation_file( $file, $handle, $domain ) {

		if ( 'nfd-editor-chat' === $handle ) {
			$locale = \determine_locale();
			$key    = \md5( 'build/' . NFD_EDITOR_CHAT_VERSION . '/chat-editor.js' );
			$file   = NFD_EDITOR_CHAT_DIR . "/languages/{$domain}-{$locale}-{$key}.json";
		}

		return $file;
	}

	/**
	 * Add custom admin class on block editor pages.
	 *
	 * @param string $classes Body classes.
	 * @return string
	 */
	public static function add_admin_body_class( $classes ) {
		$current_screen = \get_current_screen();

		if ( $current_screen && \method_exists( $current_screen, 'is_block_editor' ) && $current_screen->is_block_editor() ) {
			$classes .= ' nfd-editor-chat-enabled';
		}

		return $classes;
	}

	/**
	 * Get site context data for the AI assistant.
	 *
	 * @return array
	 */
	private static function get_site_context() {
		$onboarding = \get_option( 'nfd_module_onboarding_state_input', array() );

		return array(
			'title'          => \get_bloginfo( 'name' ),
			'description'    => ! empty( $onboarding['prompt'] ) ? $onboarding['prompt'] : \get_bloginfo( 'description' ),
			'siteType'       => $onboarding['siteType'] ?? '',
			'locale'         => \get_locale(),
			'classification' => \get_option( 'nfd-ai-site-gen-siteclassification', '' ),
		);
	}

	/**
	 * Load text domain for Module
	 *
	 * @return void
	 */
	public static function load_text_domain() {

		\load_plugin_textdomain(
			'nfd-editor-chat',
			false,
			NFD_EDITOR_CHAT_DIR . '/languages'
		);

		\load_script_textdomain(
			'nfd-editor-chat',
			'nfd-editor-chat',
			NFD_EDITOR_CHAT_DIR . '/languages'
		);
	}
}
