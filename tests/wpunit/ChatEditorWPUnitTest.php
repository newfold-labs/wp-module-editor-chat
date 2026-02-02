<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * ChatEditor wpunit tests (static properties and methods).
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\ChatEditor
 */
class ChatEditorWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Allowed referrers includes nfd-editor-chat.
	 *
	 * @return void
	 */
	public function test_allowed_referrers() {
		$ref = new \ReflectionClass( ChatEditor::class );
		$prop = $ref->getProperty( 'allowed_referrers' );
		$prop->setAccessible( true );
		$allowed = $prop->getValue();
		$this->assertIsArray( $allowed );
		$this->assertContains( 'nfd-editor-chat', $allowed );
	}

	/**
	 * load_script_translation_file returns custom path for nfd-editor-chat handle.
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
	 * load_script_translation_file returns original file for other handle.
	 *
	 * @return void
	 */
	public function test_load_script_translation_file_for_other_handle() {
		$original = '/some/path/script.json';
		$file     = ChatEditor::load_script_translation_file( $original, 'other-handle', 'other-domain' );
		$this->assertSame( $original, $file );
	}

	/**
	 * add_admin_body_class returns input unchanged when no current screen (WP_Screen is final, cannot mock).
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
	 * add_admin_body_class returns a string containing the original classes.
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
}
