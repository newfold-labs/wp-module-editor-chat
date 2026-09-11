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
		remove_all_filters( 'nfd_editor_chat_local_abilities_enabled' );
		remove_all_filters( 'nfd_editor_chat_local_ability_names' );
		remove_all_filters( 'script_module_data_@newfold-labs/editor-chat-local-abilities' );
		parent::tearDown();
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
		$this->assertSame( array( 'editor/get-editor-tree' ), LocalAbilities::get_enabled_ability_names() );
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

		add_filter( 'nfd_editor_chat_local_abilities_enabled', '__return_false' );

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

		LocalAbilities::enqueue_local_abilities();

		$this->assertIsInt(
			has_filter(
				'script_module_data_@newfold-labs/editor-chat-local-abilities',
				array( LocalAbilities::class, 'filter_local_abilities_script_module_data' )
			)
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
		$this->assertSame( array( 'editor/get-editor-tree' ), $result['abilityNames'] );
	}
}
