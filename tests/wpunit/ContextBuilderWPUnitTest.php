<?php

namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\Module\EditorChat\Services\ContextBuilder;

/**
 * ContextBuilder wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\Services\ContextBuilder
 */
class ContextBuilderWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Set up test; ensure option used by build_context is an array to avoid notices.
	 *
	 * @return void
	 */
	public function setUp(): void {
		parent::setUp();
		update_option( 'nfd_module_onboarding_state_input', array() );
	}

	/**
	 * build_context returns array with page and site keys.
	 *
	 * @return void
	 */
	public function test_build_context_returns_page_and_site() {
		$builder = new ContextBuilder();
		$context = $builder->build_context( array( 'page' => array() ) );
		$this->assertIsArray( $context );
		$this->assertArrayHasKey( 'page', $context );
		$this->assertArrayHasKey( 'site', $context );
	}

	/**
	 * build_context site key has expected structure.
	 *
	 * @return void
	 */
	public function test_build_context_site_structure() {
		$builder = new ContextBuilder();
		$context = $builder->build_context( array( 'page' => array() ) );
		$site    = $context['site'];
		$this->assertArrayHasKey( 'site_title', $site );
		$this->assertArrayHasKey( 'site_info', $site );
		$this->assertArrayHasKey( 'site_type', $site );
		$this->assertArrayHasKey( 'site_locale', $site );
		$this->assertArrayHasKey( 'site_classification', $site );
		$this->assertArrayHasKey( 'themejson', $site );
		$this->assertArrayHasKey( 'global_styles', $site );
	}

	/**
	 * build_context page key has expected default keys.
	 *
	 * @return void
	 */
	public function test_build_context_page_defaults() {
		$builder = new ContextBuilder();
		$context = $builder->build_context( array( 'page' => array() ) );
		$page    = $context['page'];
		$this->assertArrayHasKey( 'page_id', $page );
		$this->assertArrayHasKey( 'page_title', $page );
		$this->assertArrayHasKey( 'selected_block', $page );
		$this->assertArrayHasKey( 'content', $page );
	}
}
