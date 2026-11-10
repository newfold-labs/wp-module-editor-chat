<?php

namespace NewfoldLabs\WP\Module\EditorChat;

use NewfoldLabs\WP\Module\EditorChat\Database\EditorChatTable;

/**
 * EditorChatTable wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\Database\EditorChatTable
 */
class EditorChatTableWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Drop the table and version option so each test starts clean.
	 *
	 * @return void
	 */
	public function setUp(): void {
		parent::setUp();
		$this->drop_table();
		\delete_option( EditorChatTable::VERSION_OPTION );
	}

	/**
	 * Leave the table in place for other suites.
	 *
	 * @return void
	 */
	public function tearDown(): void {
		EditorChatTable::maybe_upgrade();
		parent::tearDown();
	}

	/**
	 * Drop the custom table (DDL implicitly commits; fine for this table).
	 *
	 * @return void
	 */
	private function drop_table() {
		global $wpdb;
		$table = EditorChatTable::get_table_name();
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.SchemaChange -- test cleanup of our own table.
		$wpdb->query( "DROP TABLE IF EXISTS {$table}" );
	}

	/**
	 * Whether the custom table exists.
	 *
	 * @return bool
	 */
	private function table_exists() {
		global $wpdb;
		$table = EditorChatTable::get_table_name();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test helper.
		return $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );
	}

	/**
	 * Table name uses the WordPress prefix.
	 *
	 * @return void
	 */
	public function test_table_name_uses_prefix() {
		global $wpdb;
		$this->assertSame( $wpdb->prefix . 'nfd_editor_chats', EditorChatTable::get_table_name() );
	}

	/**
	 * First upgrade creates the table and stores the schema version.
	 *
	 * @return void
	 */
	public function test_maybe_upgrade_creates_table_and_stores_version() {
		$this->assertFalse( $this->table_exists() );

		EditorChatTable::maybe_upgrade();

		$this->assertTrue( $this->table_exists() );
		$this->assertSame( EditorChatTable::DB_VERSION, \get_option( EditorChatTable::VERSION_OPTION ) );
	}

	/**
	 * Upgrade does nothing when the stored version is already current.
	 *
	 * @return void
	 */
	public function test_maybe_upgrade_is_noop_when_version_current() {
		\update_option( EditorChatTable::VERSION_OPTION, EditorChatTable::DB_VERSION );

		EditorChatTable::maybe_upgrade();

		$this->assertFalse( $this->table_exists() );
	}

	/**
	 * The table has a primary key and no secondary index.
	 *
	 * @return void
	 */
	public function test_table_has_primary_key_only() {
		global $wpdb;
		EditorChatTable::maybe_upgrade();
		$table = EditorChatTable::get_table_name();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- test helper.
		$indexes = $wpdb->get_results( "SHOW INDEX FROM {$table}" );

		$names = array_unique( wp_list_pluck( $indexes, 'Key_name' ) );
		$this->assertSame( array( 'PRIMARY' ), array_values( $names ) );
	}
}
