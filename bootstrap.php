<?php

namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\ModuleLoader\Container;
use NewfoldLabs\WP\Module\EditorChat\Application;

if ( \function_exists( 'add_action' ) ) {
	\add_action(
		'newfold_container_set',
		function ( Container $container ) {

			// Set Global Constants
			if ( ! \defined( 'NFD_EDITOR_CHAT_VERSION' ) ) {
				\define( 'NFD_EDITOR_CHAT_VERSION', '1.0.7' );
			}
			if ( ! \defined( 'NFD_EDITOR_CHAT_DIR' ) ) {
				\define( 'NFD_EDITOR_CHAT_DIR', __DIR__ );
			}
			if ( ! \defined( 'NFD_EDITOR_CHAT_BUILD_DIR' ) && \defined( 'NFD_EDITOR_CHAT_VERSION' ) ) {
				\define( 'NFD_EDITOR_CHAT_BUILD_DIR', NFD_EDITOR_CHAT_DIR . '/build/' . NFD_EDITOR_CHAT_VERSION );
			}
			if ( ! \defined( 'NFD_EDITOR_CHAT_BUILD_URL' ) && \defined( 'NFD_EDITOR_CHAT_VERSION' ) ) {
				\define( 'NFD_EDITOR_CHAT_BUILD_URL', $container->plugin()->url . 'vendor/newfold-labs/wp-module-editor-chat/build/' . NFD_EDITOR_CHAT_VERSION );
			}

			new Application( $container );
		}
	);
}
