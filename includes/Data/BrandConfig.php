<?php

namespace NewfoldLabs\WP\Module\EditorChat\Data;

use function NewfoldLabs\WP\ModuleLoader\container;

/**
 * Brand configuration for multi-brand host plugins.
 */
final class BrandConfig {

	/**
	 * Default customer portal URLs keyed by brand plugin id.
	 *
	 * @var array<string, array<string, string>>
	 */
	private static $portal_links = array(
		'bluehost'      => array(
			'accountUrl' => 'https://www.bluehost.com/my-account',
			'emailUrl'   => 'https://www.bluehost.com/my-account/email/email-bh',
			'billingUrl' => 'https://www.bluehost.com/my-account/billing-center-v2',
		),
		'hostgator'     => array(
			'accountUrl' => 'https://www.hostgator.com/my-account/login',
			'emailUrl'   => 'https://www.hostgator.com/my-account/hosting/details/email',
			'billingUrl' => 'https://www.hostgator.com/my-account/login',
		),
		'crazydomains'  => array(
			'accountUrl' => 'https://www.crazydomains.com/my-account/home/',
			'emailUrl'   => 'https://www.crazydomains.com/contact/',
			'billingUrl' => 'https://www.crazydomains.com/my-account/home/',
		),
		'web'           => array(
			'accountUrl' => 'https://www.web.com/my-account',
			'emailUrl'   => 'https://www.web.com/email-service',
			'billingUrl' => 'https://www.web.com/my-account',
		),
	);

	/**
	 * Brand identifier for API handshake (e.g. bluehost, hostgator).
	 *
	 * @return string
	 */
	public static function get_brand_id(): string {
		if ( defined( 'STARTER_PLUGIN_BRAND' ) ) {
			return \STARTER_PLUGIN_BRAND;
		}

		try {
			$plugin = container()->plugin();
			if ( is_object( $plugin ) && ! empty( $plugin->id ) ) {
				return (string) $plugin->id;
			}
			if ( is_object( $plugin ) && ! empty( $plugin->brand ) ) {
				return \sanitize_title( (string) $plugin->brand );
			}
		} catch ( \Throwable $e ) {
			// Fall through.
		}

		$mm_brand = \get_option( 'mm_brand', 'bluehost' );

		return is_string( $mm_brand ) && '' !== $mm_brand ? $mm_brand : 'bluehost';
	}

	/**
	 * Human-readable brand name for UI strings.
	 *
	 * @return string
	 */
	public static function get_brand_name(): string {
		try {
			$name = container()->plugin()->name;
			if ( is_string( $name ) && '' !== $name ) {
				return $name;
			}
		} catch ( \Throwable $e ) {
			// Fall through.
		}

		return 'WordPress';
	}

	/**
	 * Portal and account URLs for the editor header menu.
	 *
	 * @return array<string, string>
	 */
	public static function get_portal_links(): array {
		$brand_id = self::get_brand_id();
		$links    = isset( self::$portal_links[ $brand_id ] )
			? self::$portal_links[ $brand_id ]
			: array(
				'accountUrl' => '',
				'emailUrl'   => '',
				'billingUrl' => '',
			);

		$built = array();
		foreach ( $links as $key => $url ) {
			$built[ $key ] = '' === $url ? '' : (string) apply_filters( 'nfd_build_url', $url );
		}

		/**
		 * Filter portal URLs exposed to the editor chat UI.
		 *
		 * @param array<string, string> $built    accountUrl, emailUrl, billingUrl.
		 * @param string                $brand_id Current brand plugin id.
		 */
		return (array) apply_filters( 'nfd_editor_chat_brand_links', $built, $brand_id );
	}

	/**
	 * Brand payload passed to the block editor script.
	 *
	 * @return array<string, string>
	 */
	public static function get_brand_for_js(): array {
		$links = self::get_portal_links();

		return array(
			'id'         => self::get_brand_id(),
			'name'       => self::get_brand_name(),
			'accountUrl' => \esc_url( $links['accountUrl'] ?? '' ),
			'emailUrl'   => \esc_url( $links['emailUrl'] ?? '' ),
			'billingUrl' => \esc_url( $links['billingUrl'] ?? '' ),
			'adminUrl'   => \admin_url(),
		);
	}
}
