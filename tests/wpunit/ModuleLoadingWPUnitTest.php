<?php

namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\Module\EditorChat\RestApi\ChatController;
use NewfoldLabs\WP\Module\EditorChat\RestApi\RestApi;
use NewfoldLabs\WP\Module\EditorChat\Services\ContextBuilder;

/**
 * Module loading wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\Application
 */
class ModuleLoadingWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Verify core module classes exist.
	 *
	 * @return void
	 */
	public function test_module_classes_load() {
		$this->assertTrue( class_exists( Application::class ) );
		$this->assertTrue( class_exists( ChatEditor::class ) );
		$this->assertTrue( class_exists( Permissions::class ) );
		$this->assertTrue( class_exists( RestApi::class ) );
		$this->assertTrue( class_exists( ChatController::class ) );
		$this->assertTrue( class_exists( ContextBuilder::class ) );
	}

	/**
	 * Verify WordPress factory is available.
	 *
	 * @return void
	 */
	public function test_wordpress_factory_available() {
		$this->assertTrue( function_exists( 'get_option' ) );
		$this->assertNotEmpty( get_option( 'blogname' ) );
	}
}
