<?php
/**
 * WordPress MCP Abilities for Editor Chat
 *
 * Registers WordPress abilities that can be exposed via MCP.
 *
 * @package NewfoldLabs\WP\Module\EditorChat
 */

namespace NewfoldLabs\WP\Module\EditorChat;

// Exit if accessed directly.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Abilities class
 */
class Abilities {

	/**
	 * Singleton instance.
	 *
	 * @var Abilities|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance.
	 *
	 * @return Abilities
	 */
	public static function get_instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		$this->init_hooks();
	}

	/**
	 * Initialize hooks.
	 */
	private function init_hooks() {
		add_action( 'wp_abilities_api_categories_init', array( $this, 'register_ability_categories' ), 5 );
		add_action( 'wp_abilities_api_init', array( $this, 'register_abilities' ), 5 );
	}

	/**
	 * Register ability categories.
	 */
	public function register_ability_categories() {
		if ( function_exists( 'wp_register_ability_category' ) ) {
			wp_register_ability_category(
				'nfd-editor-chat',
				array(
					'label'       => __( 'NFD Editor Chat', 'nfd-editor-chat' ),
					'description' => __( 'Newfold Editor Chat abilities for AI-powered global styles management.', 'nfd-editor-chat' ),
				)
			);
		}
	}

	/**
	 * Register all custom abilities.
	 */
	public function register_abilities() {
		if ( ! function_exists( 'wp_register_ability' ) ) {
			return;
		}

		$this->register_get_global_styles_ability();
		$this->register_update_global_palette_ability();
	}

	/**
	 * Register get global styles ability
	 */
	private function register_get_global_styles_ability() {
		wp_register_ability(
			'nfd-editor-chat/get-global-styles',
			array(
				'label'               => __( 'Get Global Styles', 'nfd-editor-chat' ),
				'description'         => __( 'Retrieve the current global styles including color palette, typography, and spacing settings.', 'nfd-editor-chat' ),
				'category'            => 'nfd-editor-chat',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'include_palette'    => array(
							'type'        => 'boolean',
							'default'     => true,
							'description' => 'Include color palette',
						),
						'include_typography' => array(
							'type'        => 'boolean',
							'default'     => true,
							'description' => 'Include typography settings',
						),
						'include_spacing'    => array(
							'type'        => 'boolean',
							'default'     => false,
							'description' => 'Include spacing settings',
						),
					),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'styles'  => array(
							'type'       => 'object',
							'properties' => array(
								'palette'    => array(
									'type'        => 'array',
									'description' => 'Color palette with slug, name, and color values',
								),
								'typography' => array(
									'type'        => 'object',
									'description' => 'Typography settings including font families and sizes',
								),
								'spacing'    => array(
									'type'        => 'object',
									'description' => 'Spacing settings',
								),
							),
						),
						'message' => array( 'type' => 'string' ),
					),
					'required'   => array( 'styles', 'message' ),
				),
				'execute_callback'    => array( $this, 'execute_get_global_styles' ),
				'permission_callback' => array( $this, 'check_edit_theme_options_permission' ),
				'meta'                => array(
					'annotations' => array(
						'readOnlyHint'   => true,
						'idempotentHint' => true,
					),
					'mcp'         => array(
						'public' => true,
						'type'   => 'tool',
					),
				),
			)
		);
	}

	/**
	 * Register update global palette ability
	 */
	private function register_update_global_palette_ability() {
		wp_register_ability(
			'nfd-editor-chat/update-global-palette',
			array(
				'label'               => __( 'Update Global Color Palette', 'nfd-editor-chat' ),
				'description'         => __( 'Update the site global color palette. You can update specific colors by slug or replace the entire palette.', 'nfd-editor-chat' ),
				'category'            => 'nfd-editor-chat',
				'input_schema'        => array(
					'type'       => 'object',
					'properties' => array(
						'colors'       => array(
							'type'        => 'array',
							'description' => 'Array of color objects to update or add. Each object should have: slug (required), color (hex value, required), name (optional, human-readable name)',
							'items'       => array(
								'type'       => 'object',
								'properties' => array(
									'slug'  => array(
										'type'        => 'string',
										'description' => 'Color slug identifier (e.g., "primary", "secondary", "background", "foreground")',
									),
									'color' => array(
										'type'        => 'string',
										'description' => 'Hex color value (e.g., "#FF5733" or "rgb(255,87,51)")',
									),
									'name'  => array(
										'type'        => 'string',
										'description' => 'Human-readable color name',
									),
								),
								'required'   => array( 'slug', 'color' ),
							),
						),
						'replace_all'  => array(
							'type'        => 'boolean',
							'default'     => false,
							'description' => 'If true, replace entire palette with provided colors. If false, only update/add the specified colors.',
						),
					),
					'required'   => array( 'colors' ),
				),
				'output_schema'       => array(
					'type'       => 'object',
					'properties' => array(
						'success'         => array( 'type' => 'boolean' ),
						'updated_colors'  => array( 'type' => 'array' ),
						'current_palette' => array( 'type' => 'array' ),
						'message'         => array( 'type' => 'string' ),
					),
					'required'   => array( 'success', 'message' ),
				),
				'execute_callback'    => array( $this, 'execute_update_global_palette' ),
				'permission_callback' => array( $this, 'check_edit_theme_options_permission' ),
				'meta'                => array(
					'annotations' => array(
						'destructiveHint' => true,
						'idempotentHint'  => true,
					),
					'mcp'         => array(
						'public' => true,
						'type'   => 'tool',
					),
				),
			)
		);
	}

	// -------------------------------------------------------------------------
	// Execute Callbacks
	// -------------------------------------------------------------------------

	/**
	 * Execute get global styles ability
	 *
	 * @param array $input The input parameters.
	 * @return array|\WP_Error The result or error.
	 */
	public function execute_get_global_styles( $input = array() ) {
		try {
			// Get merged global styles data (theme + user customizations).
			$global_styles   = wp_get_global_styles();
			$global_settings = wp_get_global_settings();

			$styles_data = array();

			// Get color palette.
			if ( $input['include_palette'] ?? true ) {
				$palette = array();

				// Get theme palette from settings.
				if ( ! empty( $global_settings['color']['palette']['theme'] ) ) {
					$palette = array_merge( $palette, $global_settings['color']['palette']['theme'] );
				}

				// Get custom palette (user overrides).
				if ( ! empty( $global_settings['color']['palette']['custom'] ) ) {
					$palette = array_merge( $palette, $global_settings['color']['palette']['custom'] );
				}

				// If no separate theme/custom, check for flat palette.
				if ( empty( $palette ) && ! empty( $global_settings['color']['palette'] ) && is_array( $global_settings['color']['palette'] ) ) {
					// Check if it's a flat array of colors.
					$first_key = array_key_first( $global_settings['color']['palette'] );
					if ( is_int( $first_key ) ) {
						$palette = $global_settings['color']['palette'];
					}
				}

				$styles_data['palette'] = $palette;

				// Also include current color styles (background, text colors).
				$styles_data['colorStyles'] = array(
					'background' => $global_styles['color']['background'] ?? null,
					'text'       => $global_styles['color']['text'] ?? null,
				);
			}

			// Get typography settings.
			if ( $input['include_typography'] ?? true ) {
				$typography = array(
					'fontFamilies' => $global_settings['typography']['fontFamilies'] ?? array(),
					'fontSizes'    => $global_settings['typography']['fontSizes'] ?? array(),
				);

				// Include current typography styles.
				if ( ! empty( $global_styles['typography'] ) ) {
					$typography['currentStyles'] = $global_styles['typography'];
				}

				$styles_data['typography'] = $typography;
			}

			// Get spacing settings.
			if ( $input['include_spacing'] ?? false ) {
				$styles_data['spacing'] = array(
					'spacingSizes'  => $global_settings['spacing']['spacingSizes'] ?? array(),
					'units'         => $global_settings['spacing']['units'] ?? array(),
					'currentStyles' => $global_styles['spacing'] ?? array(),
				);
			}

			return array(
				'styles'  => $styles_data,
				'message' => __( 'Retrieved global styles', 'nfd-editor-chat' ),
			);

		} catch ( \Exception $e ) {
			return new \WP_Error( 'execution_failed', $e->getMessage() );
		}
	}

	/**
	 * Execute update global palette ability
	 *
	 * @param array $input The input parameters.
	 * @return array|\WP_Error The result or error.
	 */
	public function execute_update_global_palette( $input = array() ) {
		try {
			$colors      = $input['colors'] ?? array();
			$replace_all = $input['replace_all'] ?? false;

			if ( empty( $colors ) || ! is_array( $colors ) ) {
				return new \WP_Error( 'invalid_colors', __( 'Colors array is required', 'nfd-editor-chat' ) );
			}

			// Validate and sanitize colors.
			$validated_colors = array();
			foreach ( $colors as $color ) {
				if ( empty( $color['slug'] ) || empty( $color['color'] ) ) {
					continue;
				}

				$validated_colors[] = array(
					'slug'  => sanitize_title( $color['slug'] ),
					'color' => sanitize_hex_color( $color['color'] ) ?: $color['color'], // Allow rgb/hsl if not hex.
					'name'  => sanitize_text_field( $color['name'] ?? ucfirst( str_replace( '-', ' ', $color['slug'] ) ) ),
				);
			}

			if ( empty( $validated_colors ) ) {
				return new \WP_Error( 'no_valid_colors', __( 'No valid colors provided', 'nfd-editor-chat' ) );
			}

			// Get the current global styles post.
			$global_styles_id = \WP_Theme_JSON_Resolver::get_user_global_styles_post_id();

			if ( ! $global_styles_id ) {
				return new \WP_Error( 'no_global_styles', __( 'Could not find global styles post', 'nfd-editor-chat' ) );
			}

			$global_styles_post = get_post( $global_styles_id );
			if ( ! $global_styles_post ) {
				return new \WP_Error( 'post_not_found', __( 'Global styles post not found', 'nfd-editor-chat' ) );
			}

			// Decode current content.
			$current_styles = json_decode( $global_styles_post->post_content, true );
			if ( ! is_array( $current_styles ) ) {
				$current_styles = array();
			}

			// Ensure structure exists.
			if ( ! isset( $current_styles['settings'] ) ) {
				$current_styles['settings'] = array();
			}
			if ( ! isset( $current_styles['settings']['color'] ) ) {
				$current_styles['settings']['color'] = array();
			}
			if ( ! isset( $current_styles['settings']['color']['palette'] ) ) {
				$current_styles['settings']['color']['palette'] = array();
			}
			if ( ! isset( $current_styles['settings']['color']['palette']['custom'] ) ) {
				$current_styles['settings']['color']['palette']['custom'] = array();
			}

			// Get existing custom palette.
			$existing_palette = $current_styles['settings']['color']['palette']['custom'];

			if ( $replace_all ) {
				// Replace entire palette.
				$new_palette = $validated_colors;
			} else {
				// Merge: update existing colors by slug, add new ones.
				$new_palette = array();

				// First, keep existing colors that aren't being updated.
				foreach ( $existing_palette as $existing_color ) {
					$found = false;
					foreach ( $validated_colors as $new_color ) {
						if ( $existing_color['slug'] === $new_color['slug'] ) {
							$found = true;
							break;
						}
					}
					if ( ! $found ) {
						$new_palette[] = $existing_color;
					}
				}

				// Add/update with new colors.
				foreach ( $validated_colors as $new_color ) {
					$new_palette[] = $new_color;
				}
			}

			// Update the styles.
			$current_styles['settings']['color']['palette']['custom'] = $new_palette;

			// Save the updated global styles.
			$result = wp_update_post(
				array(
					'ID'           => $global_styles_id,
					'post_content' => wp_json_encode( $current_styles ),
				),
				true
			);

			if ( is_wp_error( $result ) ) {
				return $result;
			}

			// Clear the global styles cache.
			delete_transient( 'global_styles' );
			delete_transient( 'global_styles_' . get_stylesheet() );

			return array(
				'success'         => true,
				'updated_colors'  => $validated_colors,
				'current_palette' => $new_palette,
				'message'         => sprintf(
					__( 'Successfully updated %d color(s) in the global palette', 'nfd-editor-chat' ),
					count( $validated_colors )
				),
			);

		} catch ( \Exception $e ) {
			return new \WP_Error( 'execution_failed', $e->getMessage() );
		}
	}

	// -------------------------------------------------------------------------
	// Permission Callbacks
	// -------------------------------------------------------------------------

	/**
	 * Check if user can edit theme options (required for global styles)
	 *
	 * @return bool|\WP_Error
	 */
	public function check_edit_theme_options_permission() {
		if ( ! is_user_logged_in() ) {
			return new \WP_Error( 'authentication_required', __( 'User must be authenticated', 'nfd-editor-chat' ) );
		}

		if ( ! current_user_can( 'edit_theme_options' ) ) {
			return new \WP_Error( 'insufficient_permissions', __( 'User cannot edit theme options', 'nfd-editor-chat' ) );
		}

		return true;
	}
}
