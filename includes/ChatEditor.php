<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * ChatEditor main class
 *
 * Handles the registration and loading of the AI chat editor assets
 * in the WordPress block editor.
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
		\add_action( 'init', array( __CLASS__, 'load_text_domain' ), 100 );
		\add_filter( 'load_script_translation_file', array( __CLASS__, 'load_script_translation_file' ), 10, 3 );
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
					'homeUrl'        => \esc_url( \get_home_url() ),
					'wpVer'          => \esc_html( \get_bloginfo( 'version' ) ),
					'nfdChatVersion' => \esc_html( NFD_EDITOR_CHAT_VERSION ),
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

		if ( \method_exists( $current_screen, 'is_block_editor' ) && $current_screen->is_block_editor() ) {
			$classes .= ' nfd-editor-chat-enabled';
		}

		return $classes;
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
