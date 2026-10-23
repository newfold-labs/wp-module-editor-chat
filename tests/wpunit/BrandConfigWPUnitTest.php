<?php

use NewfoldLabs\WP\Module\EditorChat\Data\BrandConfig;

/**
 * Brand data is read from the module loader container.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\Data\BrandConfig
 */
class BrandConfigWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

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
