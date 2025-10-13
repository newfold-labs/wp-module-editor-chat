<?php
namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * Permissions and Authorization constants and utilities.
 */
final class Permissions {

	/**
	 * WordPress Admin capabilities.
	 */
	const ADMIN = 'manage_options';

	/**
	 * WordPress Editor capabilities.
	 */
	const EDITOR = 'edit_pages';

	/**
	 * Confirm user is logged in and has admin capabilities.
	 *
	 * @return boolean
	 */
	public static function is_admin() {
		return \is_user_logged_in() && \current_user_can( self::ADMIN );
	}

	/**
	 * Confirm user is logged in and has editor user capabilities.
	 *
	 * @return boolean
	 */
	public static function is_editor() {
		return \is_user_logged_in() && \current_user_can( self::EDITOR );
	}

	/**
	 * Confirm user is logged in and has admin user capabilities.
	 *
	 * @return boolean
	 */
	public static function is_authorized_admin() {
		return \is_user_logged_in() && \current_user_can( self::ADMIN );
	}
}
