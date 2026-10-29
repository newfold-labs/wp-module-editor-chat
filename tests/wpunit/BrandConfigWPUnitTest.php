<?php

use NewfoldLabs\WP\Module\EditorChat\Data\BrandConfig;
use NewfoldLabs\WP\ModuleLoader\Container;

/**
 * Brand data is read from the module loader container.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\Data\BrandConfig
 */
class BrandConfigWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Seed container brand payload without loading module bootstrap (see tests/wpunit/_bootstrap.php).
	 */
	public static function setUpBeforeClass(): void {
		parent::setUpBeforeClass();

		if ( ! class_exists( Container::class ) || ! function_exists( 'NewfoldLabs\WP\ModuleLoader\container' ) ) {
			return;
		}

		$test_container = new Container();
		$test_container->set(
			BrandConfig::CONTAINER_KEY,
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

	/**
	 * JS brand payload includes id and name keys.
	 */
	public function test_get_brand_for_editor_chat_js_has_expected_keys() {
		$brand = BrandConfig::get_brand_for_editor_chat_js();
		$this->assertArrayHasKey( 'id', $brand );
		$this->assertArrayHasKey( 'name', $brand );
		$this->assertArrayHasKey( 'accountUrl', $brand );
		$this->assertArrayHasKey( 'emailUrl', $brand );
		$this->assertArrayHasKey( 'billingUrl', $brand );
		$this->assertArrayHasKey( 'adminUrl', $brand );
	}

	/**
	 * Brand id is a non-empty string.
	 */
	public function test_get_editor_chat_brand_id_returns_string() {
		$id = BrandConfig::get_editor_chat_brand_id();
		$this->assertIsString( $id );
		$this->assertNotSame( '', $id );
	}
}
