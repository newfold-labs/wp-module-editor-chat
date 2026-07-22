<?php

namespace NewfoldLabs\WP\Module\EditorChat\Database;

/**
 * Owns the `nfd_editor_chats` custom table: schema and version-gated upgrades.
 *
 * The module has no reliable activation hook (it's loaded by the Newfold
 * Module Loader, not a standalone plugin), so the table is created/upgraded
 * lazily on `init` via a version option compare instead.
 */
final class EditorChatTable {

	/**
	 * Bump this whenever the schema changes; maybe_upgrade() re-runs dbDelta()
	 * the next time an editor loads a page.
	 */
	const DB_VERSION = '1.0.0';

	/**
	 * Option name storing the last-applied schema version.
	 */
	const VERSION_OPTION = 'nfd_editor_chats_db_version';

	/**
	 * Get the fully-prefixed table name.
	 *
	 * @return string
	 */
	public static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'nfd_editor_chats';
	}

	/**
	 * Create or update the table if the schema version has changed. Idempotent
	 * and cheap when already up to date (a single get_option() call).
	 *
	 * @return void
	 */
	public static function maybe_upgrade() {
		if ( \get_option( self::VERSION_OPTION ) === self::DB_VERSION ) {
			return;
		}

		global $wpdb;
		$table_name      = self::get_table_name();
		$charset_collate = $wpdb->get_charset_collate();

		$sql = "CREATE TABLE {$table_name} (
			id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
			user_id BIGINT UNSIGNED NOT NULL,
			site_url_hash VARCHAR(8) NOT NULL,
			post_id BIGINT UNSIGNED NOT NULL,
			post_type VARCHAR(20) NOT NULL,
			post_modified_seen_at DATETIME NOT NULL,
			title VARCHAR(255) NOT NULL DEFAULT '',
			messages LONGTEXT NOT NULL,
			created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,
			deleted_at DATETIME NULL,
			PRIMARY KEY  (id)
		) {$charset_collate};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		\dbDelta( $sql );

		\update_option( self::VERSION_OPTION, self::DB_VERSION );
	}
}
