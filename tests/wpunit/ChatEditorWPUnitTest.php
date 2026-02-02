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
	 * add_admin_body_class appends nfd-editor-chat-enabled when screen is block editor.
	 *
	 * @return void
	 */
	public function test_add_admin_body_class_appends_class_when_block_editor() {
		$screen = $this->getMockBuilder( \WP_Screen::class )
			->disableOriginalConstructor()
			->getMock();
		$screen->method( 'is_block_editor' )->willReturn( true );
		$GLOBALS['current_screen'] = $screen;
		$result = ChatEditor::add_admin_body_class( 'existing-class ' );
		$this->assertStringContainsString( 'nfd-editor-chat-enabled', $result );
		unset( $GLOBALS['current_screen'] );
	}

	/**
	 * add_admin_body_class returns unchanged when not block editor.
	 *
	 * @return void
	 */
	public function test_add_admin_body_class_unchanged_when_not_block_editor() {
		$screen = $this->getMockBuilder( \WP_Screen::class )
			->disableOriginalConstructor()
			->getMock();
		$screen->method( 'is_block_editor' )->willReturn( false );
		$GLOBALS['current_screen'] = $screen;
		$input  = 'existing-class ';
		$result = ChatEditor::add_admin_body_class( $input );
		$this->assertSame( $input, $result );
		unset( $GLOBALS['current_screen'] );
	}
}
