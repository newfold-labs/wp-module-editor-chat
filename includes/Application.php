<?php
namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\ModuleLoader\Container;

/**
 * Main Application class for the Editor Chat module.
 */
class Application {

	/**
	 * Dependency injection container.
	 *
	 * @var Container
	 */
	protected $container;

	/**
	 * Constructor.
	 *
	 * @param Container $container Dependency injection container.
	 */
	public function __construct( Container $container ) {

		$this->container = $container;

		// Delay ChatEditor initialization until WordPress functions are available
		\add_action( 'plugins_loaded', array( $this, 'initialize_chat_editor' ) );
	}

	/**
	 * Initialize ChatEditor for users with editor capabilities.
	 * Called after WordPress pluggable functions are available.
	 *
	 * @return void
	 */
	public function initialize_chat_editor() {
		if ( Permissions::is_editor() ) {
			new ChatEditor();
		}
	}
}
