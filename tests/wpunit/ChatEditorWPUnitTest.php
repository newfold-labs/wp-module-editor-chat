<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * ChatEditor wpunit tests (static properties and methods).
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\ChatEditor
 */
class ChatEditorWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Clean up globals between tests.
	 *
	 * @return void
	 */
	public function tearDown(): void {
		unset( $_GET['referrer'] );
		parent::tearDown();
	}

	/**
	 * Allowed referrers include nfd-editor-chat.
	 *
	 * @return void
	 */
	public function test_allowed_referrers() {
		$ref  = new \ReflectionClass( ChatEditor::class );
		$prop = $ref->getProperty( 'allowed_referrers' );
		$prop->setAccessible( true );
		$allowed = $prop->getValue();
		$this->assertIsArray( $allowed );
		$this->assertContains( 'nfd-editor-chat', $allowed );
	}

	/**
	 * Returns custom path for nfd-editor-chat handle from load_script_translation_file.
	 *
	 * @return void
	 */
	public function test_load_script_translation_file_for_module_handle() {
		$file = ChatEditor::load_script_translation_file( '/default/path.json', 'nfd-editor-chat', 'nfd-editor-chat' );
		$this->assertStringContainsString( NFD_EDITOR_CHAT_DIR, $file );
		$this->assertStringContainsString( 'nfd-editor-chat', $file );
		$this->assertStringEndsWith( '.json', $file );
	}

	/**
	 * Returns original file for other handle from load_script_translation_file.
	 *
	 * @return void
	 */
	public function test_load_script_translation_file_for_other_handle() {
		$original = '/some/path/script.json';
		$file     = ChatEditor::load_script_translation_file( $original, 'other-handle', 'other-domain' );
		$this->assertSame( $original, $file );
	}

	/**
	 * Returns input unchanged when no current screen from add_admin_body_class (WP_Screen is final, cannot mock).
	 *
	 * @return void
	 */
	public function test_add_admin_body_class_returns_input_when_no_screen() {
		unset( $GLOBALS['current_screen'] );
		$input  = 'existing-class ';
		$result = ChatEditor::add_admin_body_class( $input );
		$this->assertSame( $input, $result );
	}

	/**
	 * Returns a string containing the original classes from add_admin_body_class.
	 *
	 * @return void
	 */
	public function test_add_admin_body_class_returns_string() {
		unset( $GLOBALS['current_screen'] );
		$input  = 'admin-body ';
		$result = ChatEditor::add_admin_body_class( $input );
		$this->assertIsString( $result );
		$this->assertStringContainsString( $input, $result );
	}

	// ── Constructor hook verification ──────────────────────────────────

	/**
	 * Constructor registers admin_enqueue_scripts hook.
	 *
	 * @return void
	 */
	public function test_constructor_registers_admin_enqueue_scripts_hook() {
		new ChatEditor();
		$this->assertIsInt(
			has_action( 'admin_enqueue_scripts', array( ChatEditor::class, 'enqueue_site_editor_assets' ) )
		);
	}

	/**
	 * Constructor registers init hook for text domain at priority 100.
	 *
	 * @return void
	 */
	public function test_constructor_registers_init_hook_for_text_domain() {
		new ChatEditor();
		$this->assertSame(
			100,
			has_action( 'init', array( ChatEditor::class, 'load_text_domain' ) )
		);
	}

	/**
	 * Constructor registers load_script_translation_file filter.
	 *
	 * @return void
	 */
	public function test_constructor_registers_load_script_translation_file_filter() {
		new ChatEditor();
		$this->assertIsInt(
			has_filter( 'load_script_translation_file', array( ChatEditor::class, 'load_script_translation_file' ) )
		);
	}

	// ── enqueue_site_editor_assets guards ──────────────────────────────

	/**
	 * Does not enqueue on unrelated admin pages (e.g. post.php without a block editor screen).
	 *
	 * @return void
	 */
	public function test_enqueue_site_editor_assets_returns_early_when_not_site_editor() {
		global $pagenow;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = 'post.php';

		ChatEditor::enqueue_site_editor_assets();

		$this->assertFalse(
			has_filter( 'admin_body_class', array( ChatEditor::class, 'add_admin_body_class' ) )
		);

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = null;
	}

	/**
	 * Returns early when no referrer param is set.
	 *
	 * @return void
	 */
	public function test_enqueue_site_editor_assets_returns_early_when_no_referrer() {
		global $pagenow;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = 'site-editor.php';
		unset( $_GET['referrer'] );

		// Remove any pre-existing filter so we can test cleanly.
		remove_all_filters( 'admin_body_class' );

		ChatEditor::enqueue_site_editor_assets();

		$this->assertFalse(
			has_filter( 'admin_body_class', array( ChatEditor::class, 'add_admin_body_class' ) )
		);

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = null;
	}

	/**
	 * Returns early when referrer is not in the allowed list.
	 *
	 * @return void
	 */
	public function test_enqueue_site_editor_assets_returns_early_when_wrong_referrer() {
		global $pagenow;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow          = 'site-editor.php';
		$_GET['referrer'] = 'some-other-referrer';

		remove_all_filters( 'admin_body_class' );

		ChatEditor::enqueue_site_editor_assets();

		$this->assertFalse(
			has_filter( 'admin_body_class', array( ChatEditor::class, 'add_admin_body_class' ) )
		);

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = null;
	}

	/**
	 * Registers admin_body_class filter when conditions are valid.
	 *
	 * @return void
	 */
	public function test_enqueue_site_editor_assets_proceeds_with_valid_conditions() {
		global $pagenow;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow          = 'site-editor.php';
		$_GET['referrer'] = 'nfd-editor-chat';

		remove_all_filters( 'admin_body_class' );

		ChatEditor::enqueue_site_editor_assets();

		$this->assertIsInt(
			has_filter( 'admin_body_class', array( ChatEditor::class, 'add_admin_body_class' ) )
		);

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = null;
	}

	/**
	 * Adds the post-editor body class modifier on post.php block editor screens.
	 *
	 * @return void
	 */
	public function test_add_admin_body_class_adds_post_editor_modifier_on_post_screen() {
		global $pagenow;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = 'post.php';

		$screen = \WP_Screen::get( 'post' );
		set_current_screen( $screen );

		if ( ! $screen->is_block_editor() ) {
			$this->markTestSkipped( 'Post screen is not a block editor in this WordPress version.' );
		}

		$result = ChatEditor::add_admin_body_class( 'admin ' );
		$this->assertStringContainsString( 'nfd-editor-chat-enabled', $result );
		$this->assertStringContainsString( 'nfd-editor-chat--post-editor', $result );

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = null;
	}

	// ── get_site_context via Reflection ────────────────────────────────

	/**
	 * Returns the expected keys from get_site_context.
	 *
	 * @return void
	 */
	public function test_get_site_context_returns_expected_keys() {
		$ref = new \ReflectionMethod( ChatEditor::class, 'get_site_context' );
		$ref->setAccessible( true );
		$result = $ref->invoke( null );

		$this->assertIsArray( $result );
		$this->assertArrayHasKey( 'title', $result );
		$this->assertArrayHasKey( 'description', $result );
		$this->assertArrayHasKey( 'siteType', $result );
		$this->assertArrayHasKey( 'locale', $result );
		$this->assertArrayHasKey( 'classification', $result );
	}

	/**
	 * Description falls back to bloginfo when no onboarding prompt.
	 *
	 * @return void
	 */
	public function test_get_site_context_description_fallback_to_bloginfo() {
		delete_option( 'nfd_module_onboarding_state_input' );

		$ref = new \ReflectionMethod( ChatEditor::class, 'get_site_context' );
		$ref->setAccessible( true );
		$result = $ref->invoke( null );

		$this->assertSame( get_bloginfo( 'description' ), $result['description'] );
	}

	/**
	 * Description uses onboarding prompt when present.
	 *
	 * @return void
	 */
	public function test_get_site_context_description_uses_onboarding_prompt() {
		update_option( 'nfd_module_onboarding_state_input', array( 'prompt' => 'My AI prompt' ) );

		$ref = new \ReflectionMethod( ChatEditor::class, 'get_site_context' );
		$ref->setAccessible( true );
		$result = $ref->invoke( null );

		$this->assertSame( 'My AI prompt', $result['description'] );

		delete_option( 'nfd_module_onboarding_state_input' );
	}

	/**
	 * Site type defaults to empty string when missing from onboarding.
	 *
	 * @return void
	 */
	public function test_get_site_context_site_type_defaults_to_empty_string() {
		update_option( 'nfd_module_onboarding_state_input', array( 'prompt' => 'test' ) );

		$ref = new \ReflectionMethod( ChatEditor::class, 'get_site_context' );
		$ref->setAccessible( true );
		$result = $ref->invoke( null );

		$this->assertSame( '', $result['siteType'] );

		delete_option( 'nfd_module_onboarding_state_input' );
	}

	// ── add_editor_canvas_styles ───────────────────────────────────────

	/**
	 * Constructor registers the block_editor_settings_all filter at priority 10.
	 *
	 * @return void
	 */
	public function test_constructor_registers_block_editor_settings_filter() {
		new ChatEditor();
		$this->assertSame(
			10,
			has_filter( 'block_editor_settings_all', array( ChatEditor::class, 'add_editor_canvas_styles' ) )
		);
	}

	/**
	 * Leaves settings untouched outside the Site Editor context.
	 *
	 * @return void
	 */
	public function test_add_editor_canvas_styles_skips_non_site_editor_context() {
		$_GET['referrer'] = 'nfd-editor-chat';
		$context          = new \WP_Block_Editor_Context( array( 'name' => 'core/edit-post' ) );
		$settings         = array( 'styles' => array() );

		$result = ChatEditor::add_editor_canvas_styles( $settings, $context );

		$this->assertSame( $settings, $result );
	}

	/**
	 * Leaves settings untouched in the Site Editor when no referrer is set.
	 *
	 * @return void
	 */
	public function test_add_editor_canvas_styles_skips_when_no_referrer() {
		unset( $_GET['referrer'] );
		$context  = new \WP_Block_Editor_Context( array( 'name' => 'core/edit-site' ) );
		$settings = array( 'styles' => array() );

		$result = ChatEditor::add_editor_canvas_styles( $settings, $context );

		$this->assertSame( $settings, $result );
	}

	/**
	 * Leaves settings untouched when the referrer is not in the allowed list.
	 *
	 * @return void
	 */
	public function test_add_editor_canvas_styles_skips_when_wrong_referrer() {
		$_GET['referrer'] = 'some-other-referrer';
		$context          = new \WP_Block_Editor_Context( array( 'name' => 'core/edit-site' ) );
		$settings         = array( 'styles' => array() );

		$result = ChatEditor::add_editor_canvas_styles( $settings, $context );

		$this->assertSame( $settings, $result );
	}

	/**
	 * Appends the rounded-corner canvas style for a valid Site Editor request.
	 *
	 * @return void
	 */
	public function test_add_editor_canvas_styles_appends_style_for_valid_request() {
		$_GET['referrer'] = 'nfd-editor-chat';
		$context          = new \WP_Block_Editor_Context( array( 'name' => 'core/edit-site' ) );
		$settings         = array( 'styles' => array( array( 'css' => '.existing{}' ) ) );

		$result = ChatEditor::add_editor_canvas_styles( $settings, $context );

		$this->assertCount( 2, $result['styles'] );

		$appended = end( $result['styles'] );
		$this->assertArrayHasKey( 'css', $appended );
		$this->assertStringContainsString( '.is-root-container', $appended['css'] );
		$this->assertStringContainsString( 'border-start-start-radius:12px', $appended['css'] );
	}
}
