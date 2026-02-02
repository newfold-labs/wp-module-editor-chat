<?php

namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\Module\EditorChat\RestApi\ChatController;

/**
 * ChatController wpunit tests (params and permission check).
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\RestApi\ChatController
 */
class ChatControllerWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Controller get_collection_params returns expected keys.
	 *
	 * @return void
	 */
	public function test_get_collection_params_structure() {
		$controller = new ChatController();
		$params     = $controller->get_collection_params();
		$this->assertIsArray( $params );
		$this->assertArrayHasKey( 'message', $params );
		$this->assertArrayHasKey( 'context', $params );
		$this->assertArrayHasKey( 'conversationId', $params );
		$this->assertSame( 'string', $params['message']['type'] );
		$this->assertTrue( $params['message']['required'] );
		$this->assertTrue( $params['conversationId']['required'] );
	}

	/**
	 * send_message_permissions_check returns false when not logged in.
	 *
	 * @return void
	 */
	public function test_send_message_permissions_check_when_logged_out() {
		wp_set_current_user( 0 );
		$controller = new ChatController();
		$request    = new \WP_REST_Request();
		$this->assertFalse( $controller->send_message_permissions_check( $request ) );
	}

	/**
	 * send_message_permissions_check returns true for editor.
	 *
	 * @return void
	 */
	public function test_send_message_permissions_check_when_editor() {
		$user_id = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $user_id );
		$controller = new ChatController();
		$request    = new \WP_REST_Request();
		$this->assertTrue( $controller->send_message_permissions_check( $request ) );
	}
}
