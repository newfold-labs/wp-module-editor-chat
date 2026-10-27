<?php

namespace NewfoldLabs\WP\Module\EditorChat\Data;

use function NewfoldLabs\WP\ModuleLoader\container;

/**
 * Reads editor-chat brand data from the host plugin container.
 *
 * Onboarding (or the host plugin) should set `editor_chat_brand` on the container.
 */
final class BrandConfig {

	/**
	 * Container key for the localized brand payload.
	 */
	const CONTAINER_KEY = 'editor_chat_brand';

	/**
	 * Brand id sent to the editor-chat worker handshake.
	 *
	 * @return string
	 */
	public static function get_editor_chat_brand_id(): string {
		$payload = self::get_brand_for_editor_chat_js();

		return isset( $payload['id'] ) ? (string) $payload['id'] : 'bluehost';
	}

	/**
	 * Human-readable brand name for UI strings.
	 *
	 * @return string
	 */
	public static function get_current_brand_name(): string {
		$payload = self::get_brand_for_editor_chat_js();
		$name    = isset( $payload['name'] ) ? (string) $payload['name'] : '';

		return '' !== $name ? $name : 'WordPress';
	}

	/**
	 * Brand payload localized to `window.nfdEditorChat.brand`.
	 *
	 * @return array<string, string>
	 */
	public static function get_brand_for_editor_chat_js(): array {
		$from_container = self::get_payload_from_container();
		if ( null !== $from_container ) {
			return $from_container;
		}

		return self::get_fallback_payload();
	}

	/**
	 * Read brand payload from the module loader container when present.
	 *
	 * @return array<string, string>|null
	 */
	private static function get_payload_from_container(): ?array {
		if ( ! function_exists( 'NewfoldLabs\WP\ModuleLoader\container' ) ) {
			return null;
		}

		try {
			$module_container = container();
			if ( $module_container->has( self::CONTAINER_KEY ) ) {
				return (array) $module_container->get( self::CONTAINER_KEY );
			}
		} catch ( \Throwable $e ) {
			return null;
		}

		return null;
	}

	/**
	 * Minimal fallback when onboarding has not populated the container.
	 *
	 * @return array<string, string>
	 */
	private static function get_fallback_payload(): array {
		$id   = 'bluehost';
		$name = 'WordPress';

		try {
			$plugin = container()->plugin();
			if ( is_object( $plugin ) ) {
				if ( ! empty( $plugin->id ) ) {
					$id = (string) $plugin->id;
				}
				if ( ! empty( $plugin->name ) ) {
					$name = (string) $plugin->name;
				}
			}
		} catch ( \Throwable $e ) {
			// Fall through.
		}

		return array(
			'id'         => $id,
			'name'       => $name,
			'accountUrl' => '',
			'emailUrl'   => '',
			'billingUrl' => '',
			'adminUrl'   => \admin_url(),
		);
	}
}
