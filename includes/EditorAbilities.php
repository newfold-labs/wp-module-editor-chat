<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * Registers and enqueues the reusable client-side editor abilities.
 */
class EditorAbilities {

	const PUBLIC_MODULE           = '@newfold-labs/editor-chat/editor-abilities';
	const BOOTSTRAP_MODULE        = '@newfold-labs/editor-chat/editor-abilities-bootstrap';
	const WEBMCP_ENV_MODULE       = '@newfold-labs/editor-chat/webmcp-env';
	const WEBMCP_BRIDGE_MODULE    = '@newfold-labs/editor-chat/webmcp-bridge';
	const WEBMCP_BOOTSTRAP_MODULE = '@newfold-labs/editor-chat/webmcp-bootstrap';
	const WEBMCP_POLYFILL_HANDLE  = 'nfd-editor-chat-webmcp-polyfill';

	/**
	 * Stable public ability names. Registration is completed in later tasks.
	 *
	 * @var string[]
	 */
	private static $ability_names = array(
		'blu-editor/get-editor-tree',
		'blu-editor/find-editor-blocks',
		'blu-editor/get-block-location',
		'blu-editor/get-editor-selection',
		'blu-editor/can-insert-block',
		'blu-editor/get-block-types',
		'blu-editor/get-block-type',
		'blu-editor/get-patterns',
		'blu-editor/get-pattern',
		'blu-editor/get-pattern-categories',
		'blu-editor/select-block',
		'blu-editor/edit-block',
		'blu-editor/insert-block',
		'blu-editor/move-block',
		'blu-editor/remove-block',
		'blu-editor/update-block',
		'blu-editor/transform-block',
		'blu-editor/insert-pattern',
		'blu-editor/create-pattern',
		'blu-editor/undo',
		'blu-editor/redo',
	);

	/**
	 * Persistent page-lifetime loader state.
	 *
	 * @var bool
	 */
	private static $modules_registered = false;

	/**
	 * Whether native modules have been enqueued.
	 *
	 * @var bool
	 */
	private static $native_enqueued    = false;

	/**
	 * Whether the WebMCP polyfill has been registered.
	 *
	 * @var bool
	 */
	private static $webmcp_registered  = false;

	/**
	 * Whether WebMCP assets have been enqueued.
	 *
	 * @var bool
	 */
	private static $webmcp_enqueued    = false;

	/**
	 * Whether the public module-data filter has been added.
	 *
	 * @var bool
	 */
	private static $data_filter_added  = false;

	/**
	 * Ability names exposed through script-module data.
	 *
	 * @var string[]
	 */
	private static $module_ability_names = array();

	/**
	 * Hook the opt-in block-editor lifecycle.
	 */
	public function __construct() {
		\add_action( 'enqueue_block_editor_assets', array( $this, 'maybe_enqueue' ) );
	}

	/**
	 * Let another plugin opt the current block-editor screen into loading.
	 *
	 * @return void
	 */
	public function maybe_enqueue() {
		global $pagenow;

		$screen = \get_current_screen();
		$should = \apply_filters(
			'nfd_editor_chat_should_enqueue_editor_abilities',
			false,
			$screen,
			$pagenow
		);

		if ( $should ) {
			self::enqueue();
		}
	}

	/**
	 * Enqueue the reusable native layer and optional WebMCP adapter.
	 *
	 * @param bool $with_webmcp Whether to expose registered abilities to WebMCP.
	 * @return bool True when the reusable layer was enqueued.
	 */
	public static function enqueue( $with_webmcp = false ) {
		global $wp_version;

		if ( ! Permissions::is_editor() ) {
			return false;
		}

		if ( ! \apply_filters( 'nfd_editor_chat_editor_abilities_enabled', true ) ) {
			return false;
		}

		if ( \version_compare( $wp_version, '7.0', '<' ) ) {
			return false;
		}

		if ( ! static::supports_script_modules() ) {
			return false;
		}

		$screen = \get_current_screen();
		if (
			! $screen ||
			! \method_exists( $screen, 'is_block_editor' ) ||
			! $screen->is_block_editor()
		) {
			return false;
		}

		$ability_names = \apply_filters(
			'nfd_editor_chat_editor_ability_names',
			self::$ability_names
		);
		$ability_names = self::normalize_ability_names( $ability_names );

		if ( ! self::$modules_registered ) {
			self::$module_ability_names = $ability_names;
			static::register_modules();
			self::$modules_registered = true;
		}

		if ( ! self::$native_enqueued ) {
			static::enqueue_script_module( self::PUBLIC_MODULE );
			static::enqueue_script_module( self::BOOTSTRAP_MODULE );
			self::$native_enqueued = true;
		}

		if ( $with_webmcp ) {
			self::enqueue_webmcp();
		}

		return true;
	}

	/**
	 * Whether the required WordPress script-module API is available.
	 *
	 * @return bool Support status.
	 */
	protected static function supports_script_modules() {
		return \function_exists( 'wp_register_script_module' ) &&
			\function_exists( 'wp_enqueue_script_module' );
	}

	/**
	 * Reset persistent state for isolated subclasses in tests.
	 *
	 * @return void
	 */
	protected static function reset_state() {
		self::$modules_registered    = false;
		self::$native_enqueued       = false;
		self::$webmcp_registered     = false;
		self::$webmcp_enqueued       = false;
		self::$data_filter_added     = false;
		self::$module_ability_names  = array();
	}

	/**
	 * Keep filtered names inside the stable contract and preserve contract order.
	 *
	 * @param mixed $names Filtered names.
	 * @return string[] Normalized allow-list.
	 */
	private static function normalize_ability_names( $names ) {
		if ( ! \is_array( $names ) ) {
			return array();
		}

		return \array_values(
			\array_filter(
				self::$ability_names,
				function ( $name ) use ( $names ) {
					return \in_array( $name, $names, true );
				}
			)
		);
	}

	/**
	 * Register the native script-module graph.
	 *
	 * @return void
	 */
	private static function register_modules() {
		$js_url = \defined( 'NFD_EDITOR_CHAT_JS_URL' )
			? NFD_EDITOR_CHAT_JS_URL
			: '';

		static::register_script_module(
			self::PUBLIC_MODULE,
			$js_url . 'abilities/index.js',
			array( '@wordpress/abilities' ),
			NFD_EDITOR_CHAT_VERSION
		);
		static::register_script_module(
			self::BOOTSTRAP_MODULE,
			$js_url . 'abilities/bootstrap.js',
			array( self::PUBLIC_MODULE ),
			NFD_EDITOR_CHAT_VERSION
		);
		static::register_script_module(
			self::WEBMCP_ENV_MODULE,
			$js_url . 'abilities/webmcp-env.js',
			array(),
			NFD_EDITOR_CHAT_VERSION
		);
		static::register_script_module(
			self::WEBMCP_BRIDGE_MODULE,
			$js_url . 'abilities/webmcp-bridge.js',
			array( '@wordpress/abilities', self::WEBMCP_ENV_MODULE ),
			NFD_EDITOR_CHAT_VERSION
		);
		static::register_script_module(
			self::WEBMCP_BOOTSTRAP_MODULE,
			$js_url . 'abilities/webmcp-bootstrap.js',
			array(
				self::PUBLIC_MODULE,
				self::WEBMCP_ENV_MODULE,
				self::WEBMCP_BRIDGE_MODULE,
			),
			NFD_EDITOR_CHAT_VERSION
		);

		if ( ! self::$data_filter_added ) {
			static::register_module_data_filter();
			self::$data_filter_added = true;
		}
	}

	/**
	 * Enqueue the optional WebMCP adapter and its browser fallback.
	 *
	 * @return void
	 */
	private static function enqueue_webmcp() {
		$js_url = \defined( 'NFD_EDITOR_CHAT_JS_URL' )
			? NFD_EDITOR_CHAT_JS_URL
			: '';

		if ( ! self::$webmcp_registered ) {
			static::register_polyfill_script(
				self::WEBMCP_POLYFILL_HANDLE,
				$js_url . 'vendor/webmcp-polyfill/webmcp-polyfill.js'
			);
			self::$webmcp_registered = true;
		}

		if ( ! self::$webmcp_enqueued ) {
			static::enqueue_script( self::WEBMCP_POLYFILL_HANDLE );
			static::enqueue_script_module( self::WEBMCP_BOOTSTRAP_MODULE );
			self::$webmcp_enqueued = true;
		}
	}

	/**
	 * Register one script module.
	 *
	 * @param string       $id      Module ID.
	 * @param string       $src     Module URL.
	 * @param string[]     $deps    Dependencies.
	 * @param string|false $version Version.
	 * @return void
	 */
	protected static function register_script_module( $id, $src, $deps, $version ) {
		\wp_register_script_module( $id, $src, $deps, $version );
	}

	/**
	 * Enqueue one script module.
	 *
	 * @param string $id Module ID.
	 * @return void
	 */
	protected static function enqueue_script_module( $id ) {
		\wp_enqueue_script_module( $id );
	}

	/**
	 * Register the WebMCP polyfill script.
	 *
	 * @param string $handle Script handle.
	 * @param string $src    Script URL.
	 * @return void
	 */
	protected static function register_polyfill_script( $handle, $src ) {
		\wp_register_script(
			$handle,
			$src,
			array(),
			NFD_EDITOR_CHAT_VERSION,
			false
		);
	}

	/**
	 * Enqueue one classic script.
	 *
	 * @param string $handle Script handle.
	 * @return void
	 */
	protected static function enqueue_script( $handle ) {
		\wp_enqueue_script( $handle );
	}

	/**
	 * Add the public module's data filter once.
	 *
	 * @return void
	 */
	protected static function register_module_data_filter() {
		\add_filter(
			'script_module_data_' . self::PUBLIC_MODULE,
			function ( $data ) {
				$data['abilityNames'] = self::$module_ability_names;
				return $data;
			}
		);
	}
}
