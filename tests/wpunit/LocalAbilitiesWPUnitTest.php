<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * LocalAbilities wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\LocalAbilities
 */
class LocalAbilitiesWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Remove any filters a previous test left behind.
	 *
	 * @return void
	 */
	public function tearDown(): void {
		global $pagenow;

		remove_all_filters( 'nfd_editor_chat_local_abilities_enabled' );
		remove_all_filters( 'nfd_editor_chat_local_ability_names' );
		remove_all_filters( 'script_module_data_@newfold-labs/editor-chat-local-abilities' );
		unset( $_GET['referrer'] );
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = null;
		parent::tearDown();
	}

	/**
	 * Set $pagenow and the referrer param so ChatEditor::is_site_editor_chat_screen()
	 * passes, the same minimal context LocalAbilities::enqueue_local_abilities()
	 * requires before it looks at anything else. Mirrors
	 * ChatEditorWPUnitTest::test_enqueue_site_editor_assets_proceeds_with_valid_conditions().
	 *
	 * @return void
	 */
	private function set_up_chat_screen() {
		global $pagenow;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow          = 'site-editor.php';
		$_GET['referrer'] = 'nfd-editor-chat';
	}

	/**
	 * Skip a test that exercises enqueue_local_abilities() past the screen
	 * gate on a WordPress version older than 7.0: the version guard would
	 * return early before whatever this test means to check, making the
	 * assertion pass without exercising it. The local test WordPress
	 * checkout in this repo is older than 7.0, so this fires there today.
	 *
	 * @return void
	 */
	private function skip_unless_wp_supports_abilities() {
		global $wp_version;

		if ( version_compare( $wp_version, '7.0', '<' ) ) {
			$this->markTestSkipped( 'Requires WordPress 7.0+ (client-side Abilities API).' );
		}
	}

	/**
	 * Constructor registers the enqueue_block_editor_assets hook.
	 *
	 * @return void
	 */
	public function test_constructor_registers_enqueue_hook() {
		new LocalAbilities();

		$this->assertIsInt(
			has_action( 'enqueue_block_editor_assets', array( LocalAbilities::class, 'enqueue_local_abilities' ) )
		);
	}

	/**
	 * Default enabled ability names include editor/get-editor-tree.
	 *
	 * @return void
	 */
	public function test_get_enabled_ability_names_default() {
		$this->assertSame(
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
				'editor/update-block',
			),
			LocalAbilities::get_enabled_ability_names()
		);
	}

	/**
	 * The nfd_editor_chat_local_ability_names filter can narrow the list.
	 *
	 * @return void
	 */
	public function test_get_enabled_ability_names_respects_filter() {
		add_filter(
			'nfd_editor_chat_local_ability_names',
			function () {
				return array();
			}
		);

		$this->assertSame( array(), LocalAbilities::get_enabled_ability_names() );
	}

	/**
	 * Does nothing when script modules are unavailable.
	 *
	 * @return void
	 */
	public function test_enqueue_returns_early_without_script_modules_support() {
		if ( function_exists( 'wp_enqueue_script_module' ) ) {
			$this->markTestSkipped( 'This WordPress version supports script modules; cannot test the fallback branch.' );
		}

		$this->set_up_chat_screen();

		LocalAbilities::enqueue_local_abilities();

		$this->assertFalse(
			has_filter( 'script_module_data_@newfold-labs/editor-chat-local-abilities' )
		);
	}

	/**
	 * Does nothing when nfd_editor_chat_local_abilities_enabled is false.
	 *
	 * @return void
	 */
	public function test_enqueue_returns_early_when_disabled_by_filter() {
		if ( ! function_exists( 'wp_enqueue_script_module' ) ) {
			$this->markTestSkipped( 'This WordPress version has no script modules support.' );
		}
		$this->skip_unless_wp_supports_abilities();

		add_filter( 'nfd_editor_chat_local_abilities_enabled', '__return_false' );
		$this->set_up_chat_screen();

		LocalAbilities::enqueue_local_abilities();

		$this->assertFalse(
			has_filter( 'script_module_data_@newfold-labs/editor-chat-local-abilities' )
		);
	}

	/**
	 * Registers the script-module-data filter when enabled.
	 *
	 * @return void
	 */
	public function test_enqueue_registers_script_module_data_filter_when_enabled() {
		if ( ! function_exists( 'wp_enqueue_script_module' ) ) {
			$this->markTestSkipped( 'This WordPress version has no script modules support.' );
		}
		$this->skip_unless_wp_supports_abilities();

		$this->set_up_chat_screen();

		LocalAbilities::enqueue_local_abilities();

		$this->assertIsInt(
			has_filter(
				'script_module_data_@newfold-labs/editor-chat-local-abilities',
				array( LocalAbilities::class, 'filter_local_abilities_script_module_data' )
			)
		);
	}

	/**
	 * Does nothing on a block editor screen that isn't the chat's own
	 * (e.g. a plain post edit with no `?referrer=nfd-editor-chat`, or a
	 * screen not covered by ChatEditor::is_site_editor_chat_screen() /
	 * is_post_editor_chat_screen() at all) — this class must not enqueue on
	 * every block editor load, only where the chat that consumes it loads.
	 *
	 * @return void
	 */
	public function test_enqueue_returns_early_when_not_a_chat_screen() {
		if ( ! function_exists( 'wp_enqueue_script_module' ) ) {
			$this->markTestSkipped( 'This WordPress version has no script modules support.' );
		}

		global $pagenow;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = 'edit.php';

		LocalAbilities::enqueue_local_abilities();

		$this->assertFalse(
			has_filter( 'script_module_data_@newfold-labs/editor-chat-local-abilities' )
		);
	}

	/**
	 * Adds the ability-names key.
	 *
	 * @return void
	 */
	public function test_filter_local_abilities_script_module_data_adds_ability_names() {
		$result = LocalAbilities::filter_local_abilities_script_module_data( array() );

		$this->assertArrayHasKey( 'abilityNames', $result );
		$this->assertSame(
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
				'editor/update-block',
			),
			$result['abilityNames']
		);
	}
}
