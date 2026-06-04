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
		\add_action( 'admin_bar_menu', array( __CLASS__, 'admin_bar_menu' ), 99 );
		\add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_admin_bar_assets' ) );
		\add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_admin_bar_assets' ) );
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
			: 'https://cf-worker-ai-chat.bluehost.workers.dev';

		if ( empty( $worker_url ) ) {
			return new \WP_Error(
				'worker_url_not_configured',
				__( 'Editor chat Worker URL is not configured. Set NFD_EDITOR_CHAT_WORKER_URL in wp-config.php.', 'nfd-editor-chat' ),
				array( 'status' => 500 )
			);
		}

		$worker_url = \untrailingslashit( $worker_url );

		// Get Hiive auth token for server-to-server handshake
		$hiive_token = '';
		if ( class_exists( '\NewfoldLabs\WP\Module\Data\HiiveConnection' ) ) {
			$hiive_token = \NewfoldLabs\WP\Module\Data\HiiveConnection::get_auth_token();
		}

		if ( empty( $hiive_token ) ) {
			return new \WP_Error(
				'hiive_token_unavailable',
				__( 'Unable to retrieve Hiive authentication token.', 'nfd-editor-chat' ),
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
				\sprintf( __( 'Worker handshake returned HTTP %d.', 'nfd-editor-chat' ), $status_code ),
				array( 'status' => 502 )
			);
		}

		$data = json_decode( \wp_remote_retrieve_body( $handshake_response ), true );

		if ( empty( $data['session_token'] ) ) {
			return new \WP_Error(
				'handshake_failed',
				__( 'Worker handshake did not return a session token.', 'nfd-editor-chat' ),
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

			$args = array(
				'nonce'          => \wp_create_nonce( 'wp_rest' ),
				'nfdRestURL'     => \get_home_url() . '/index.php?rest_route=/nfd-editor-chat/v1',
				'mcpUrl'         => \esc_url_raw( \rest_url( 'blu/mcp' ) ),
				'configEndpoint' => \esc_url_raw( \rest_url( 'nfd-editor-chat/v1/config' ) ),
				'homeUrl'        => \esc_url( \get_home_url() ),
				'wpVer'          => \esc_html( \get_bloginfo( 'version' ) ),
				'nfdChatVersion' => \esc_html( NFD_EDITOR_CHAT_VERSION ),
				'model'          => defined( 'NFD_EDITOR_CHAT_MODEL' ) ? \NFD_EDITOR_CHAT_MODEL : '',
				'site'           => self::get_site_context(),
				'pagesCount'     => \array_sum( (array) \wp_count_posts( 'page' ) ),
			);

			$upgrade_banner_data = self::get_plan_upgrade_banner_data();
			if ( $upgrade_banner_data ) {
				$args['planUpgradeBanner'] = $upgrade_banner_data;
			}

			\wp_localize_script( 'nfd-editor-chat', 'nfdEditorChat', $args );

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
	 * Retrieve the upgrade banner data.
	 *
	 * @return array
	 */
	private static function get_plan_upgrade_banner_data() {
		static $data = null;

		if ( is_null( $data ) ) {
			$data      = array();
			$plan_data = \get_option( 'wvc_plan_data', '{}' );
			$plan_data = ! ! $plan_data && \is_string( $plan_data ) ? \json_decode( $plan_data, true ) : array();

			if ( $plan_data ) {
				$plan_data   = \is_array( $plan_data ) ? $plan_data : array();
				$message     = \sanitize_text_field( $plan_data['infoBannerText'] ?? '' );
				$upgrade_url = \esc_url_raw( $plan_data['upgrade_url'] ?? '' );

				if ( $message && $upgrade_url ) {
					$data = array(
						'message'    => $message,
						'upgradeUrl' => $upgrade_url,
					);
				}
			}
		}

		return $data;
	}

	/**
	 * Filter default WP script translations file to load the correct one
	 *
	 * @param string $file   The translations file.
	 * @param string $handle Script handle.
	 * @param string $domain The strings textdomain.
	 *
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
	 *
	 * @return string
	 */
	public static function add_admin_body_class( $classes ) {
		$current_screen = \get_current_screen();

		if ( $current_screen && \method_exists( $current_screen, 'is_block_editor' ) && $current_screen->is_block_editor() ) {
			$classes .= ' nfd-editor-chat-enabled';

			if ( self::get_plan_upgrade_banner_data() ) {
				$classes .= ' nfd-editor-chat--has-plan-upgrade-banner';
			}
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

	/**
	 * Add menu in admin bar.
	 *
	 * @param \WP_Admin_Bar $wp_admin_bar The admin bar.
	 */
	public static function admin_bar_menu( $wp_admin_bar ) {
		$icon = '<svg width="14" height="13" viewBox="0 0 14 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M4.99937 1.85729C5.108 1.85731 5.21368 1.8902 5.3004 1.95096C5.38712 2.01173 5.45017 2.09707 5.48001 2.19408L6.02198 3.95604C6.13867 4.33549 6.35759 4.68106 6.65806 4.9601C6.95853 5.23915 7.33063 5.44246 7.73922 5.55083L9.63645 6.05416C9.74084 6.08193 9.83266 6.14051 9.89802 6.22104C9.96338 6.30157 9.99874 6.39968 9.99874 6.50053C9.99874 6.60137 9.96338 6.69948 9.89802 6.78001C9.83266 6.86054 9.74084 6.91912 9.63645 6.9469L7.73922 7.45022C7.33063 7.5586 6.95853 7.76191 6.65806 8.04095C6.35759 8.31999 6.13867 8.66556 6.02198 9.04502L5.48001 10.807C5.4501 10.9039 5.38703 10.9892 5.30031 11.0499C5.2136 11.1106 5.10796 11.1434 4.99937 11.1434C4.89078 11.1434 4.78514 11.1106 4.69843 11.0499C4.61171 10.9892 4.54863 10.9039 4.51873 10.807L3.97676 9.04502C3.86006 8.66556 3.64115 8.31999 3.34068 8.04095C3.04021 7.76191 2.66811 7.5586 2.25952 7.45022L0.362287 6.9469C0.257896 6.91912 0.166078 6.86054 0.100716 6.78001C0.0353537 6.69948 0 6.60137 0 6.50053C0 6.39968 0.0353537 6.30157 0.100716 6.22104C0.166078 6.14051 0.257896 6.08193 0.362287 6.05416L2.25952 5.55083C2.66811 5.44246 3.04021 5.23915 3.34068 4.9601C3.64115 4.68106 3.86006 4.33549 3.97676 3.95604L4.51873 2.19408C4.54857 2.09707 4.61162 2.01173 4.69834 1.95096C4.78506 1.8902 4.89073 1.85731 4.99937 1.85729ZM10.999 7.20546e-08C11.1106 -5.7614e-05 11.2189 0.0345233 11.3069 0.0982423C11.3948 0.161961 11.4573 0.251159 11.4844 0.351648L11.6563 0.993033C11.8137 1.57499 12.303 2.0294 12.9296 2.17551L13.6202 2.33524C13.7286 2.36018 13.8249 2.41811 13.8938 2.49979C13.9626 2.58148 14 2.68222 14 2.78594C14 2.88966 13.9626 2.9904 13.8938 3.07209C13.8249 3.15377 13.7286 3.21171 13.6202 3.23664L12.9296 3.39637C12.303 3.54248 11.8137 3.9969 11.6563 4.57885L11.4844 5.22023C11.4575 5.32091 11.3951 5.41035 11.3072 5.47427C11.2192 5.53819 11.1107 5.57292 10.999 5.57292C10.8874 5.57292 10.7789 5.53819 10.6909 5.47427C10.603 5.41035 10.5406 5.32091 10.5137 5.22023L10.3417 4.57885C10.2648 4.29309 10.1057 4.03212 9.88145 3.82384C9.65718 3.61556 9.37618 3.46781 9.06848 3.39637L8.37785 3.23664C8.26944 3.21171 8.17314 3.15377 8.10431 3.07209C8.03548 2.9904 7.99809 2.88966 7.99809 2.78594C7.99809 2.68222 8.03548 2.58148 8.10431 2.49979C8.17314 2.41811 8.26944 2.36018 8.37785 2.33524L9.06848 2.17551C9.37618 2.10407 9.65718 1.95632 9.88145 1.74804C10.1057 1.53976 10.2648 1.27879 10.3417 0.993033L10.5137 0.351648C10.5408 0.251159 10.6033 0.161961 10.6912 0.0982423C10.7792 0.0345233 10.8875 -5.7614e-05 10.999 7.20546e-08ZM9.9991 8.35782C10.1041 8.35776 10.2065 8.38841 10.2917 8.44542C10.3769 8.50243 10.4406 8.5829 10.4737 8.67542L10.7364 9.40781C10.8364 9.68455 11.0697 9.90247 11.3684 9.99471L12.157 10.2393C12.2563 10.2702 12.3426 10.3294 12.4038 10.4083C12.4649 10.4873 12.4978 10.5822 12.4978 10.6794C12.4978 10.7767 12.4649 10.8715 12.4038 10.9505C12.3426 11.0295 12.2563 11.0887 12.157 11.1196L11.3684 11.3642C11.0704 11.457 10.8357 11.6737 10.7364 11.9511L10.4731 12.6835C10.4397 12.7757 10.376 12.8559 10.291 12.9126C10.206 12.9694 10.1038 13 9.9991 13C9.89435 13 9.79224 12.9694 9.70719 12.9126C9.62215 12.8559 9.55846 12.7757 9.52512 12.6835L9.2618 11.9511C9.2127 11.8144 9.13004 11.6903 9.02035 11.5884C8.91067 11.4865 8.77698 11.4098 8.62984 11.3642L7.84121 11.1196C7.74191 11.0887 7.65558 11.0295 7.59443 10.9505C7.53327 10.8715 7.50037 10.7767 7.50037 10.6794C7.50037 10.5822 7.53327 10.4873 7.59443 10.4083C7.65558 10.3294 7.74191 10.2702 7.84121 10.2393L8.62984 9.99471C8.92782 9.90185 9.16248 9.68517 9.2618 9.40781L9.52512 8.67542C9.55827 8.583 9.62187 8.5026 9.70693 8.4456C9.792 8.3886 9.89421 8.35789 9.9991 8.35782Z" fill="white"/></svg>';
		// translators: %s is the "Bluehost" brand name and should not be translated. Example: "Bluehost AI Editor".
		$title = \sprintf( __( '%s AI Editor', 'nfd-editor-chat' ), 'Bluehost' );

		$editor_args = array(
			'canvas'   => 'edit',
			'referrer' => 'nfd-editor-chat',
		);
		$url         = \add_query_arg( $editor_args, \admin_url( 'site-editor.php' ) );

		$args = array(
			'id'     => 'nfd-editor-chat',
			'parent' => 'top-secondary',
			'title'  => $icon . $title,
			'href'   => $url,
		);

		$wp_admin_bar->add_node( $args );
	}

	/**
	 * Enqueue styles for admin-bar.
	 */
	public static function enqueue_admin_bar_assets() {
		\wp_enqueue_style( 'nfd-editor-chat-admin-bar', \NFD_EDITOR_CHAT_ASSETS_URL . 'css/admin-bar.css', [], NFD_EDITOR_CHAT_VERSION );
	}
}
