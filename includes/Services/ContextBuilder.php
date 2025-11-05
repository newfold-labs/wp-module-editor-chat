<?php

namespace NewfoldLabs\WP\Module\EditorChat\Services;

/**
 * Context Builder
 *
 * Handles building the context object for chat requests
 */
class ContextBuilder {

	/**
	 * Build the context object
	 *
	 * @param array $context The context array.
	 * @return array The context array.
	 */
	public function build_context( $context ) {
		global $post;

		$onboarding_prompt = \get_option( 'nfd_module_onboarding_state_input', '' );

		$_context = array();

		$_context['page'] = wp_parse_args(
			$context['page'],
			array(
				'page_id'        => $post ? $post->ID : '',
				'page_title'     => $post ? $post->post_title : '',
				'selected_block' => '',
				'content'        => '',
			)
		);

		$_context['site'] = array(
			'site_title'          => \get_bloginfo( 'name' ),
			'site_info'           => $onboarding_prompt['prompt'] ?? \get_bloginfo( 'description' ),
			'site_type'           => $onboarding_prompt['siteType'] ?? '',
			'site_locale'         => \get_locale(),
			'site_classification' => \get_option( 'nfd-ai-site-gen-siteclassification', '' ),
			'themejson'           => $this->get_theme_json(),
			'global_styles'       => $this->get_global_styles(),
		);

		return $_context;
	}

	/**
	 * Get theme.json data
	 *
	 * @return array
	 */
	private function get_theme_json() {
		if ( ! function_exists( 'wp_get_global_settings' ) ) {
			return array();
		}

		return \wp_get_global_settings();
	}

	/**
	 * Get global styles
	 *
	 * @return array
	 */
	private function get_global_styles() {
		$global_styles_id = \WP_Theme_JSON_Resolver::get_user_global_styles_post_id();

		if ( ! $global_styles_id ) {
			return array();
		}

		$global_styles = \get_post( $global_styles_id );

		if ( ! $global_styles ) {
			return array();
		}

		$styles = json_decode( $global_styles->post_content, true );

		return $styles ?? array();
	}
}
