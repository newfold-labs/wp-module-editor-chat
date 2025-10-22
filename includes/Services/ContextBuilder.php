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

		// Process template parts if they exist in the context
		$template_parts_content = array();
		if ( isset( $context['pageContent']['templateParts'] ) && is_array( $context['pageContent']['templateParts'] ) ) {
			foreach ( $context['pageContent']['templateParts'] as $template_part ) {
				$template_part_content = $this->get_template_part_content_data(
					$template_part['slug'],
					$template_part['theme'] ?? \get_stylesheet(),
					$template_part['area'] ?? ''
				);

				if ( $template_part_content ) {
					$template_parts_content[] = $template_part_content;
				}
			}
		}

		// Update the pageContent blocks with innerBlocks for both post-content and template-part
		if ( isset( $context['pageContent']['blocks'] ) && is_array( $context['pageContent']['blocks'] ) ) {
			foreach ( $context['pageContent']['blocks'] as $index => $block ) {
				if ( isset( $block['isPostContent'] ) && $block['isPostContent'] ) {
					// Parse the post content into blocks
					$post_blocks = \parse_blocks( $block['content'] );
					// Filter out empty blocks and whitespace-only blocks
					$post_blocks = $this->filter_empty_blocks( $post_blocks );
					$context['pageContent']['blocks'][ $index ]['innerBlocks'] = $post_blocks;
				}

				if ( isset( $block['isTemplatePart'] ) && $block['isTemplatePart'] ) {
					// Find the corresponding template part content
					foreach ( $template_parts_content as $template_part_content ) {
						if ( $template_part_content['slug'] === $block['attributes']['slug'] ) {
							$context['pageContent']['blocks'][ $index ]['innerBlocks'] = $template_part_content['blocks'];
							$context['pageContent']['blocks'][ $index ]['content']     = $template_part_content['content'];
							break;
						}
					}
				}
			}
		}

		$context = \wp_parse_args(
			$context,
			array(
				'pageId'           => $context['pageId'] ?? '',
				'pageContent'      => $context['pageContent'] ?? '',
				'selectedBlock'    => $context['selectedBlock'] ?? '',
				'siteTitle'        => \get_bloginfo( 'name' ),
				'locale'           => \get_locale(),
				'classification'   => \get_option( 'nfd-ai-site-gen-siteclassification', '' ),
				'onboardingPrompt' => $onboarding_prompt['prompt'] ?? \get_bloginfo( 'description' ),
				'siteType'         => $onboarding_prompt['siteType'] ?? '',
				'themeJson'        => $this->get_theme_json(),
				'globalStyles'     => $this->get_global_styles(),
			)
		);

		return $context;
	}

	/**
	 * Get template part content data
	 *
	 * @param string $slug  Template part slug.
	 * @param string $theme Theme name.
	 * @param string $area  Template part area.
	 * @return array|null Template part content or null.
	 */
	public function get_template_part_content_data( $slug, $theme, $area ) {
		// Get the template part post
		$template_part = get_block_template( $theme . '//' . $slug, 'wp_template_part' );

		if ( ! $template_part ) {
			return null;
		}

		// Parse the template part content
		$blocks = parse_blocks( $template_part->content );
		// Filter out empty blocks
		$blocks = $this->filter_empty_blocks( $blocks );

		return array(
			'slug'    => $slug,
			'theme'   => $theme,
			'area'    => $area,
			'content' => $template_part->content,
			'blocks'  => $blocks,
		);
	}

	/**
	 * Filter out empty blocks and whitespace-only blocks
	 *
	 * @param array $blocks Array of blocks to filter.
	 * @return array Filtered blocks.
	 */
	private function filter_empty_blocks( $blocks ) {
		$filtered_blocks = array();

		foreach ( $blocks as $block ) {
			// Skip blocks with null blockName (empty blocks)
			if ( null === $block['blockName'] ) {
				continue;
			}

			// Skip blocks that are only whitespace
			$inner_html = trim( $block['innerHTML'] ?? '' );
			if ( empty( $inner_html ) && empty( $block['innerBlocks'] ) ) {
				continue;
			}

			// Recursively filter inner blocks
			if ( ! empty( $block['innerBlocks'] ) ) {
				$block['innerBlocks'] = $this->filter_empty_blocks( $block['innerBlocks'] );
			}

			$filtered_blocks[] = $block;
		}

		return $filtered_blocks;
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
