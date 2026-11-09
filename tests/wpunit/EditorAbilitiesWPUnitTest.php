<?php

namespace NewfoldLabs\WP\Module\EditorChat;

// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound

/**
 * Test seam for loader support and call-count assertions.
 */
class TestEditorAbilities extends EditorAbilities {

	/**
	 * Whether script modules are supported.
	 *
	 * @var bool
	 */
	public static $supports_script_modules = true;

	/**
	 * Loader operation counts.
	 *
	 * @var array<string, int>
	 */
	public static $calls = array();

	/**
	 * Reset inherited loader state and test counters.
	 *
	 * @return void
	 */
	public static function reset_test_state() {
		parent::reset_state();
		self::$supports_script_modules = true;
		self::$calls                   = array();
	}

	/**
	 * Override script-module support detection.
	 *
	 * @return bool Support status.
	 */
	protected static function supports_script_modules() {
		return self::$supports_script_modules;
	}

	/**
	 * Count one loader operation.
	 *
	 * @param string $operation Operation key.
	 * @return void
	 */
	private static function count_call( $operation ) {
		self::$calls[ $operation ] = ( self::$calls[ $operation ] ?? 0 ) + 1;
	}

	/**
	 * Count and perform script-module registration.
	 *
	 * @param string       $id      Module ID.
	 * @param string       $src     Module URL.
	 * @param string[]     $deps    Dependencies.
	 * @param string|false $version Version.
	 * @return void
	 */
	protected static function register_script_module( $id, $src, $deps, $version ) {
		self::count_call( 'register_module:' . $id );
		parent::register_script_module( $id, $src, $deps, $version );
	}

	/**
	 * Count and perform script-module enqueueing.
	 *
	 * @param string $id Module ID.
	 * @return void
	 */
	protected static function enqueue_script_module( $id ) {
		self::count_call( 'enqueue_module:' . $id );
		parent::enqueue_script_module( $id );
	}

	/**
	 * Count and perform classic script registration.
	 *
	 * @param string $handle Script handle.
	 * @param string $src    Script URL.
	 * @return void
	 */
	protected static function register_polyfill_script( $handle, $src ) {
		self::count_call( 'register_script:' . $handle );
		parent::register_polyfill_script( $handle, $src );
	}

	/**
	 * Count and perform classic script enqueueing.
	 *
	 * @param string $handle Script handle.
	 * @return void
	 */
	protected static function enqueue_script( $handle ) {
		self::count_call( 'enqueue_script:' . $handle );
		parent::enqueue_script( $handle );
	}

	/**
	 * Count and register the module-data filter.
	 *
	 * @return void
	 */
	protected static function register_module_data_filter() {
		self::count_call( 'module_data_filter' );
		parent::register_module_data_filter();
	}
}

/**
 * EditorAbilities wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\EditorAbilities
 */
class EditorAbilitiesWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * WordPress version before a test changes it.
	 *
	 * @var string|null
	 */
	private $wp_version_before;

	/**
	 * Reset persistent loader state before each test.
	 *
	 * @return void
	 */
	public function setUp(): void {
		parent::setUp();
		TestEditorAbilities::reset_test_state();
	}

	/**
	 * Restore globals and hooks changed by a test.
	 *
	 * @return void
	 */
	public function tearDown(): void {
		global $pagenow, $wp_version;

		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = null;
		if ( null !== $this->wp_version_before ) {
			// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
			$wp_version = $this->wp_version_before;
		}
		$this->wp_version_before = null;
		\remove_all_filters( 'nfd_editor_chat_editor_abilities_enabled' );
		\remove_all_filters( 'nfd_editor_chat_editor_ability_names' );
		\remove_all_filters( 'nfd_editor_chat_should_enqueue_editor_abilities' );
		\wp_set_current_user( 0 );
		parent::tearDown();
	}

	/**
	 * Create an editor and a block-editor screen.
	 *
	 * @return void
	 */
	private function set_editor_context() {
		global $pagenow, $wp_version;

		$this->wp_version_before = $wp_version;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$wp_version = '7.0';
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$pagenow = 'post.php';
		\wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		\set_current_screen( 'post' );
	}

	/**
	 * Failed gates must enqueue no public module.
	 *
	 * @return void
	 */
	public function test_enqueue_rejects_users_without_editor_permission() {
		\wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$this->assertFalse( EditorAbilities::enqueue() );
		$this->assertNotContains( EditorAbilities::PUBLIC_MODULE, \wp_script_modules()->get_queue() );
	}

	/**
	 * WordPress versions below 7.0 fail soft.
	 *
	 * @return void
	 */
	public function test_enqueue_returns_false_below_wordpress_7() {
		$this->set_editor_context();
		global $wp_version;
		// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
		$wp_version = '6.9.9';

		$this->assertFalse( EditorAbilities::enqueue() );
		$this->assertNotContains( EditorAbilities::PUBLIC_MODULE, \wp_script_modules()->get_queue() );
	}

	/**
	 * Missing script-module APIs fail soft.
	 *
	 * @return void
	 */
	public function test_enqueue_returns_false_without_script_module_support() {
		$this->set_editor_context();
		TestEditorAbilities::$supports_script_modules = false;

		$this->assertFalse( TestEditorAbilities::enqueue() );
		$this->assertNotContains( EditorAbilities::PUBLIC_MODULE, \wp_script_modules()->get_queue() );
	}

	/**
	 * Registers the public module and passes the filtered 21-name allow-list.
	 *
	 * @return void
	 */
	public function test_enqueue_registers_public_module_and_filtered_names() {
		$this->set_editor_context();
		$names = null;
		\add_filter(
			'nfd_editor_chat_editor_ability_names',
			function ( $ability_names ) use ( &$names ) {
				$names = $ability_names;
				return array( 'blu-editor/get-editor-tree' );
			}
		);

		$this->assertTrue( EditorAbilities::enqueue() );
		$this->assertCount( 21, $names );
		$this->assertSame( $names, array_values( array_unique( $names ) ) );
		foreach ( $names as $name ) {
			$this->assertStringStartsWith( 'blu-editor/', $name );
		}
		$this->assertContains( EditorAbilities::PUBLIC_MODULE, \wp_script_modules()->get_queue() );
	}

	/**
	 * Repeated enqueue calls do not duplicate module queue entries.
	 *
	 * @return void
	 */
	public function test_enqueue_is_idempotent() {
		$this->set_editor_context();

		$this->assertTrue( TestEditorAbilities::enqueue( true ) );
		$this->assertTrue( TestEditorAbilities::enqueue( true ) );
		$queue        = \wp_script_modules()->get_queue();
		$queue_counts = array_count_values( $queue );

		$this->assertSame( 1, $queue_counts[ EditorAbilities::PUBLIC_MODULE ] );
		$this->assertSame( 1, $queue_counts[ EditorAbilities::BOOTSTRAP_MODULE ] );
		$this->assertSame( 1, $queue_counts[ EditorAbilities::WEBMCP_BOOTSTRAP_MODULE ] );
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'register_module:' . EditorAbilities::PUBLIC_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'register_module:' . EditorAbilities::BOOTSTRAP_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'register_module:' . EditorAbilities::WEBMCP_ENV_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'register_module:' . EditorAbilities::WEBMCP_BRIDGE_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'register_module:' . EditorAbilities::WEBMCP_BOOTSTRAP_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'enqueue_module:' . EditorAbilities::PUBLIC_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'enqueue_module:' . EditorAbilities::BOOTSTRAP_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'enqueue_module:' . EditorAbilities::WEBMCP_BOOTSTRAP_MODULE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'register_script:' . EditorAbilities::WEBMCP_POLYFILL_HANDLE ]
		);
		$this->assertSame(
			1,
			TestEditorAbilities::$calls[ 'enqueue_script:' . EditorAbilities::WEBMCP_POLYFILL_HANDLE ]
		);
		$this->assertSame( 1, TestEditorAbilities::$calls['module_data_filter'] );
	}

	/**
	 * External plugins can opt a supported block-editor screen in.
	 *
	 * @return void
	 */
	public function test_screen_filter_can_opt_in_a_block_editor_screen() {
		$this->set_editor_context();
		$received = null;
		\add_filter(
			'nfd_editor_chat_should_enqueue_editor_abilities',
			function ( $should_enqueue, $screen, $pagenow ) use ( &$received ) {
				$received = array( $should_enqueue, $screen, $pagenow );
				return true;
			},
			10,
			3
		);

		$loader = new EditorAbilities();
		$loader->maybe_enqueue();

		$this->assertFalse( $received[0] );
		$this->assertInstanceOf( \WP_Screen::class, $received[1] );
		$this->assertSame( 'post.php', $received[2] );
		$this->assertContains( EditorAbilities::PUBLIC_MODULE, \wp_script_modules()->get_queue() );
	}

	/**
	 * WebMCP opt-in loads the adapter and polyfill.
	 *
	 * @return void
	 */
	public function test_webmcp_flag_enqueues_the_bridge_and_polyfill() {
		$this->set_editor_context();

		$this->assertTrue( EditorAbilities::enqueue( true ) );
		$this->assertContains( EditorAbilities::WEBMCP_BOOTSTRAP_MODULE, \wp_script_modules()->get_queue() );
		$this->assertTrue( \wp_script_is( EditorAbilities::WEBMCP_POLYFILL_HANDLE, 'enqueued' ) );
	}
}

// phpcs:enable Generic.Files.OneObjectStructurePerFile.MultipleFound
