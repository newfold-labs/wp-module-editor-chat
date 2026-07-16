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

	// ── register_rest_routes ───────────────────────────────────────────

	/**
	 * Constructor registers the rest_api_init hook for route registration.
	 *
	 * @return void
	 */
	public function test_constructor_registers_rest_api_init_hook() {
		new ChatEditor();
		$this->assertIsInt(
			has_action( 'rest_api_init', array( ChatEditor::class, 'register_rest_routes' ) )
		);
	}

	/**
	 * Registers the config, upload and delete REST routes.
	 *
	 * @return void
	 */
	public function test_register_rest_routes_registers_upload_routes() {
		// Ensure the REST server exists so register_rest_route() targets it.
		$server = rest_get_server();
		ChatEditor::register_rest_routes();

		$routes = $server->get_routes();

		$this->assertArrayHasKey( '/nfd-editor-chat/v1/config', $routes );
		$this->assertArrayHasKey( '/nfd-editor-chat/v1/upload', $routes );
		$this->assertArrayHasKey(
			'/nfd-editor-chat/v1/upload/(?P<filename>[a-zA-Z0-9_\-\.]+)',
			$routes
		);
	}

	// ── upload_temp_file ───────────────────────────────────────────────

	/**
	 * Build a WP_REST_Request carrying the given $_FILES-style payload.
	 *
	 * @param array $file File params, or null to send no file.
	 * @return \WP_REST_Request
	 */
	private function make_upload_request( $file ) {
		$request = new \WP_REST_Request( 'POST', '/nfd-editor-chat/v1/upload' );
		$request->set_file_params( null === $file ? array() : array( 'file' => $file ) );
		return $request;
	}

	/**
	 * Returns a 400 error when no file is provided.
	 *
	 * @return void
	 */
	public function test_upload_temp_file_errors_when_no_file() {
		$result = ChatEditor::upload_temp_file( $this->make_upload_request( null ) );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'no_file', $result->get_error_code() );
		$this->assertSame( 400, $result->get_error_data()['status'] );
	}

	/**
	 * Returns a 400 error when the upload reports an error code.
	 *
	 * @return void
	 */
	public function test_upload_temp_file_errors_when_upload_error() {
		$result = ChatEditor::upload_temp_file(
			$this->make_upload_request(
				array(
					'name'     => 'pic.png',
					'type'     => 'image/png',
					'tmp_name' => '',
					'error'    => UPLOAD_ERR_INI_SIZE,
					'size'     => 0,
				)
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'no_file', $result->get_error_code() );
	}

	/**
	 * Rejects disallowed mime types with a 400 error.
	 *
	 * @return void
	 */
	public function test_upload_temp_file_rejects_invalid_mime_type() {
		$result = ChatEditor::upload_temp_file(
			$this->make_upload_request(
				array(
					'name'     => 'evil.exe',
					'type'     => 'application/x-msdownload',
					'tmp_name' => '/tmp/whatever',
					'error'    => 0,
					'size'     => 10,
				)
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'invalid_file_type', $result->get_error_code() );
		$this->assertSame( 400, $result->get_error_data()['status'] );
	}

	/**
	 * An allowed mime type passes validation and reaches the move step, which
	 * fails for a non-HTTP-uploaded file and surfaces an upload_failed error.
	 *
	 * @return void
	 */
	public function test_upload_temp_file_fails_to_move_non_uploaded_file() {
		$tmp = \wp_tempnam( 'nfd-chat-test' );
		\file_put_contents( $tmp, 'data' );

		$result = ChatEditor::upload_temp_file(
			$this->make_upload_request(
				array(
					'name'     => 'note.txt',
					'type'     => 'text/plain',
					'tmp_name' => $tmp,
					'error'    => 0,
					'size'     => 4,
				)
			)
		);

		// move_uploaded_file() rejects files not received via HTTP POST.
		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'upload_failed', $result->get_error_code() );
		$this->assertSame( 500, $result->get_error_data()['status'] );

		@\unlink( $tmp );
	}

	/**
	 * Accepts allowlisted extensions even when the browser reports octet-stream.
	 *
	 * @return void
	 */
	public function test_upload_temp_file_accepts_csv_with_octet_stream_mime() {
		$tmp = \wp_tempnam( 'nfd-chat-test' );
		\file_put_contents( $tmp, 'a,b' );

		$result = ChatEditor::upload_temp_file(
			$this->make_upload_request(
				array(
					'name'     => 'data.csv',
					'type'     => 'application/octet-stream',
					'tmp_name' => $tmp,
					'error'    => 0,
					'size'     => 3,
				)
			)
		);

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'upload_failed', $result->get_error_code() );

		@\unlink( $tmp );
	}

	/**
	 * Creates the temp upload directory with a guard index.php file.
	 *
	 * @return void
	 */
	public function test_ensure_temp_upload_dir_creates_directory() {
		$upload_dir = \wp_upload_dir();
		$temp_dir   = $upload_dir['basedir'] . '/' . ChatEditor::TEMP_UPLOAD_SUBDIR . '/';

		if ( \file_exists( $temp_dir ) ) {
			$temp_files = \glob( $temp_dir . '*' );
			if ( false !== $temp_files ) {
				\array_map( 'unlink', $temp_files );
			}
			\rmdir( $temp_dir );
		}

		$this->assertTrue( ChatEditor::ensure_temp_upload_dir() );
		$this->assertDirectoryExists( $temp_dir );
		$this->assertFileExists( $temp_dir . 'index.php' );
	}

	// ── delete_temp_file ───────────────────────────────────────────────

	/**
	 * Returns a 404 error when the target file does not exist.
	 *
	 * @return void
	 */
	public function test_delete_temp_file_errors_when_missing() {
		$request = new \WP_REST_Request( 'DELETE' );
		$request->set_param( 'filename', 'does-not-exist.png' );

		$result = ChatEditor::delete_temp_file( $request );

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'file_not_found', $result->get_error_code() );
		$this->assertSame( 404, $result->get_error_data()['status'] );
	}

	/**
	 * Deletes an existing temp file and returns a 204 response.
	 *
	 * @return void
	 */
	public function test_delete_temp_file_removes_existing_file() {
		$upload_dir = \wp_upload_dir();
		$temp_dir   = $upload_dir['basedir'] . '/' . ChatEditor::TEMP_UPLOAD_SUBDIR . '/';
		\wp_mkdir_p( $temp_dir );

		$filename = 'deleteme.txt';
		$filepath = $temp_dir . $filename;
		\file_put_contents( $filepath, 'bye' );
		$this->assertFileExists( $filepath );

		$request = new \WP_REST_Request( 'DELETE' );
		$request->set_param( 'filename', $filename );

		$result = ChatEditor::delete_temp_file( $request );

		$this->assertInstanceOf( \WP_REST_Response::class, $result );
		$this->assertSame( 204, $result->get_status() );
		$this->assertFileDoesNotExist( $filepath );
	}
}
