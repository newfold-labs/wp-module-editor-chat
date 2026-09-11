<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * Registers the local (in-browser) editor abilities: WordPress client-side
 * abilities bridged to WebMCP, so the chat can call them with zero network
 * cost instead of a round trip to /blu/mcp.
 *
 * This class never touches /blu/mcp, wp-module-mcp, or ChatEditor's REST
 * routes — the local-abilities surface is deliberately self-contained here.
 * When the client-side Abilities API is unavailable (WordPress older than
 * 7.0, or wp_enqueue_script_module missing for any other reason), every
 * method here is a no-op and the rest of the module runs exactly as it does
 * today.
 */
final class LocalAbilities {

	/**
	 * Constructor.
	 */
	public function __construct() {
		\add_action( 'enqueue_block_editor_assets', array( __CLASS__, 'enqueue_local_abilities' ) );
	}

	/**
	 * Enqueue the local-abilities script modules and the WebMCP polyfill.
	 *
	 * @return void
	 */
	public static function enqueue_local_abilities() {
		if ( ! \function_exists( 'wp_enqueue_script_module' ) ) {
			return;
		}

		if ( ! \apply_filters( 'nfd_editor_chat_local_abilities_enabled', true ) ) {
			return;
		}

		// Ensure the Abilities client (and its import map entry) are available.
		\wp_enqueue_script_module( '@wordpress/abilities' );

		// Installs document.modelContext for the bridge to register tools into.
		\wp_register_script(
			'nfd-editor-chat-webmcp-polyfill',
			NFD_EDITOR_CHAT_JS_URL . 'vendor/webmcp-polyfill/webmcp-polyfill.js',
			array(),
			NFD_EDITOR_CHAT_VERSION,
			true
		);
		\wp_enqueue_script( 'nfd-editor-chat-webmcp-polyfill' );

		\wp_register_script_module(
			'@newfold-labs/editor-chat-webmcp-env',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/webmcp-polyfill.js',
			array(),
			NFD_EDITOR_CHAT_VERSION
		);

		\wp_register_script_module(
			'@newfold-labs/editor-chat-abilities',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/abilities.js',
			array( '@wordpress/abilities' ),
			NFD_EDITOR_CHAT_VERSION
		);

		\wp_register_script_module(
			'@newfold-labs/editor-chat-webmcp-bridge',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/webmcp-bridge.js',
			array( '@wordpress/abilities', '@newfold-labs/editor-chat-webmcp-env' ),
			NFD_EDITOR_CHAT_VERSION
		);

		\wp_enqueue_script_module(
			'@newfold-labs/editor-chat-local-abilities',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/index.js',
			array( '@newfold-labs/editor-chat-abilities', '@newfold-labs/editor-chat-webmcp-bridge' ),
			NFD_EDITOR_CHAT_VERSION
		);

		\add_filter(
			'script_module_data_@newfold-labs/editor-chat-local-abilities',
			array( __CLASS__, 'filter_local_abilities_script_module_data' )
		);
	}

	/**
	 * Add the enabled ability names to the bootstrap script module's data.
	 *
	 * @param array $data Existing script module data.
	 * @return array
	 */
	public static function filter_local_abilities_script_module_data( $data ) {
		$data['abilityNames'] = self::get_enabled_ability_names();
		return $data;
	}

	/**
	 * Ability names the local layer is allowed to bridge to WebMCP this request.
	 *
	 * `editor/*` abilities not in this list are still registered with
	 * the @wordpress/abilities package (cheap, in-memory) but are never
	 * exposed as a WebMCP tool, so the model never sees them.
	 *
	 * @return string[]
	 */
	public static function get_enabled_ability_names() {
		return (array) \apply_filters(
			'nfd_editor_chat_local_ability_names',
			array( 'editor/get-editor-tree' )
		);
	}
}
