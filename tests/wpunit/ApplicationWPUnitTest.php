<?php

namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\ModuleLoader\Container;

/**
 * Application wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\Application
 */
class ApplicationWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Create a mock Container or skip if class unavailable.
	 *
	 * @return Container|\PHPUnit\Framework\MockObject\MockObject
	 */
	private function make_container() {
		if ( ! class_exists( Container::class ) ) {
			$this->markTestSkipped( 'Container class is not available.' );
		}

		return $this->createMock( Container::class );
	}

	/**
	 * Constructor hooks plugins_loaded action.
	 *
	 * @return void
	 */
	public function test_constructor_hooks_plugins_loaded() {
		$container = $this->make_container();
		$app       = new Application( $container );

		$this->assertIsInt(
			has_action( 'plugins_loaded', array( $app, 'initialize_chat_editor' ) )
		);
	}

	/**
	 * initialize_chat_editor creates ChatEditor for an editor-capable user.
	 *
	 * @return void
	 */
	public function test_initialize_chat_editor_creates_chat_editor_for_editor_user() {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );

		$container = $this->make_container();
		$app       = new Application( $container );

		// Remove any pre-existing hooks so we can detect new registrations.
		remove_all_actions( 'admin_enqueue_scripts' );

		$app->initialize_chat_editor();

		$this->assertIsInt(
			has_action( 'admin_enqueue_scripts', array( ChatEditor::class, 'enqueue_site_editor_assets' ) )
		);
	}

	/**
	 * initialize_chat_editor does nothing for a subscriber (no edit_pages).
	 *
	 * @return void
	 */
	public function test_initialize_chat_editor_does_nothing_for_subscriber() {
		$user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		wp_set_current_user( $user_id );

		$container = $this->make_container();
		$app       = new Application( $container );

		remove_all_actions( 'admin_enqueue_scripts' );

		$app->initialize_chat_editor();

		$this->assertFalse(
			has_action( 'admin_enqueue_scripts', array( ChatEditor::class, 'enqueue_site_editor_assets' ) )
		);
	}

	/**
	 * initialize_chat_editor does nothing when logged out.
	 *
	 * @return void
	 */
	public function test_initialize_chat_editor_does_nothing_when_logged_out() {
		wp_set_current_user( 0 );

		$container = $this->make_container();
		$app       = new Application( $container );

		remove_all_actions( 'admin_enqueue_scripts' );

		$app->initialize_chat_editor();

		$this->assertFalse(
			has_action( 'admin_enqueue_scripts', array( ChatEditor::class, 'enqueue_site_editor_assets' ) )
		);
	}
}
