<?php
/**
 * Bootstrap file for wpunit tests.
 *
 * @package NewfoldLabs\WP\Module\EditorChat
 */

$module_dir = dirname( dirname( __DIR__ ) );

// Define constants used by the module when not loaded via container.
if ( ! defined( 'NFD_EDITOR_CHAT_VERSION' ) ) {
	define( 'NFD_EDITOR_CHAT_VERSION', '2.0.0' );
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

require_once $module_dir . '/vendor/autoload.php';

if ( class_exists( \NewfoldLabs\WP\ModuleLoader\Container::class ) && function_exists( 'NewfoldLabs\WP\ModuleLoader\container' ) ) {
	$test_container = new \NewfoldLabs\WP\ModuleLoader\Container();
	$test_container->set(
		\NewfoldLabs\WP\Module\EditorChat\Data\BrandConfig::CONTAINER_KEY,
		array(
			'id'         => 'bluehost',
			'name'       => 'Bluehost',
			'accountUrl' => 'https://example.com/account',
			'emailUrl'   => 'https://example.com/email',
			'billingUrl' => 'https://example.com/billing',
			'adminUrl'   => 'https://example.com/wp-admin/',
		)
	);
	\NewfoldLabs\WP\ModuleLoader\container( $test_container );
}

require_once $module_dir . '/bootstrap.php';
