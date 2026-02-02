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
	 * is_admin returns false when not logged in.
	 *
	 * @return void
	 */
	public function test_is_admin_when_logged_out() {
		wp_set_current_user( 0 );
		$this->assertFalse( Permissions::is_admin() );
	}

	/**
	 * is_editor returns false when not logged in.
	 *
	 * @return void
	 */
	public function test_is_editor_when_logged_out() {
		wp_set_current_user( 0 );
		$this->assertFalse( Permissions::is_editor() );
	}

	/**
	 * is_authorized_admin returns false when not logged in.
	 *
	 * @return void
	 */
	public function test_is_authorized_admin_when_logged_out() {
		wp_set_current_user( 0 );
		$this->assertFalse( Permissions::is_authorized_admin() );
	}

	/**
	 * is_admin returns true for administrator.
	 *
	 * @return void
	 */
	public function test_is_admin_when_administrator() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );
		$this->assertTrue( Permissions::is_admin() );
	}

	/**
	 * is_editor returns true for editor.
	 *
	 * @return void
	 */
	public function test_is_editor_when_editor() {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );
		$this->assertTrue( Permissions::is_editor() );
	}
}
