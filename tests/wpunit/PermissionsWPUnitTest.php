<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * Permissions wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\Permissions
 */
class PermissionsWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Admin constant is manage_options.
	 *
	 * @return void
	 */
	public function test_admin_constant() {
		$this->assertSame( 'manage_options', Permissions::ADMIN );
	}

	/**
	 * Editor constant is edit_pages.
	 *
	 * @return void
	 */
	public function test_editor_constant() {
		$this->assertSame( 'edit_pages', Permissions::EDITOR );
	}

	/**
	 * Returns false when not logged in from is_admin.
	 *
	 * @return void
	 */
	public function test_is_admin_when_logged_out() {
		wp_set_current_user( 0 );
		$this->assertFalse( Permissions::is_admin() );
	}

	/**
	 * Returns false when not logged in from is_editor.
	 *
	 * @return void
	 */
	public function test_is_editor_when_logged_out() {
		wp_set_current_user( 0 );
		$this->assertFalse( Permissions::is_editor() );
	}

	/**
	 * Returns false when not logged in from is_authorized_admin.
	 *
	 * @return void
	 */
	public function test_is_authorized_admin_when_logged_out() {
		wp_set_current_user( 0 );
		$this->assertFalse( Permissions::is_authorized_admin() );
	}

	/**
	 * Returns true for administrator from is_admin.
	 *
	 * @return void
	 */
	public function test_is_admin_when_administrator() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );
		$this->assertTrue( Permissions::is_admin() );
	}

	/**
	 * Returns true for editor from is_editor.
	 *
	 * @return void
	 */
	public function test_is_editor_when_editor() {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );
		$this->assertTrue( Permissions::is_editor() );
	}
}
