<?php
/**
 * Bootstrap file for wpunit tests.
 *
 * @package NewfoldLabs\WP\Module\EditorChat
 */

$module_dir = dirname( dirname( __DIR__ ) );

// Define constants used by the module when not loaded via container.
if ( ! defined( 'NFD_EDITOR_CHAT_VERSION' ) ) {
	define( 'NFD_EDITOR_CHAT_VERSION', '1.0.8' );
}
if ( ! defined( 'NFD_EDITOR_CHAT_DIR' ) ) {
	define( 'NFD_EDITOR_CHAT_DIR', $module_dir );
}
if ( ! defined( 'NFD_EDITOR_CHAT_BUILD_DIR' ) ) {
	define( 'NFD_EDITOR_CHAT_BUILD_DIR', $module_dir . '/build/' . NFD_EDITOR_CHAT_VERSION );
}
if ( ! defined( 'NFD_EDITOR_CHAT_BUILD_URL' ) ) {
	define( 'NFD_EDITOR_CHAT_BUILD_URL', 'https://example.com/wp-content/plugins/bluehost/vendor/newfold-labs/wp-module-editor-chat/build/' . NFD_EDITOR_CHAT_VERSION );
}

require_once $module_dir . '/bootstrap.php';
