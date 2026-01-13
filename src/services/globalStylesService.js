/* eslint-disable no-console */
/**
 * Global Styles Service
 *
 * Provides real-time updates to WordPress global styles using the Gutenberg data store.
 * Changes made through this service are immediately reflected in the Site Editor.
 */

/**
 * Get the WordPress data module
 * @return {Object|null} WordPress data object or null if not available
 */
function getWPData() {
	if (typeof window !== "undefined" && window.wp && window.wp.data) {
		return window.wp.data;
	}
	return null;
}

/**
 * Get the global styles ID from the current site editor context
 * @return {number|null} Global styles post ID or null
 */
export function getGlobalStylesId() {
	const data = getWPData();
	if (!data) {
		console.warn("WordPress data store not available");
		return null;
	}

	try {
		const coreStore = data.select("core");

		// Method 1: Use __experimentalGetCurrentGlobalStylesId if available
		if (typeof coreStore.__experimentalGetCurrentGlobalStylesId === "function") {
			const id = coreStore.__experimentalGetCurrentGlobalStylesId();
			if (id) {
				console.log("Found global styles ID via __experimentalGetCurrentGlobalStylesId:", id);
				return id;
			}
		}

		// Method 2: Try to get from edit-site store
		const editSiteStore = data.select("core/edit-site");
		if (editSiteStore) {
			// Try getSettings
			if (typeof editSiteStore.getSettings === "function") {
				const settings = editSiteStore.getSettings();
				if (settings?.__experimentalGlobalStylesUserEntityId) {
					console.log(
						"Found global styles ID via edit-site settings:",
						settings.__experimentalGlobalStylesUserEntityId
					);
					return settings.__experimentalGlobalStylesUserEntityId;
				}
			}
			// Try getEditedPostId for global styles
			if (typeof editSiteStore.getEditedPostId === "function") {
				const postId = editSiteStore.getEditedPostId();
				const postType = editSiteStore.getEditedPostType?.();
				if (postType === "wp_global_styles" && postId) {
					console.log("Found global styles ID via edit-site post:", postId);
					return postId;
				}
			}
		}

		// Method 3: Get from entity records
		const records = coreStore.getEntityRecords("root", "globalStyles", { per_page: 1 });
		if (records && records.length > 0) {
			console.log("Found global styles ID via entity records:", records[0].id);
			return records[0].id;
		}

		console.warn("Could not find global styles ID");
	} catch (error) {
		console.error("Error getting global styles ID:", error);
	}

	return null;
}

/**
 * Get current global styles from the data store
 * @return {Object} Current global styles object
 */
export function getCurrentGlobalStyles() {
	const data = getWPData();
	if (!data) {
		return { palette: [], error: "WordPress data store not available" };
	}

	try {
		const coreStore = data.select("core");
		let palette = [];
		let themePalette = [];
		let customPalette = [];
		let rawSettings = null;

		// Method 1: Get from global styles entity record
		const globalStylesId = getGlobalStylesId();
		if (globalStylesId) {
			const record = coreStore.getEditedEntityRecord("root", "globalStyles", globalStylesId);
			console.log("Global styles record:", record);

			if (record && record.settings) {
				rawSettings = record.settings;
				const paletteData = record.settings?.color?.palette;

				if (paletteData) {
					// Handle nested structure (theme/custom)
					if (paletteData.theme) {
						themePalette = paletteData.theme;
					}
					if (paletteData.custom) {
						customPalette = paletteData.custom;
					}
					// Handle flat array structure
					if (Array.isArray(paletteData)) {
						themePalette = paletteData;
					}
				}
			}
		}

		// Method 2: Fallback to base styles / theme.json data
		if (themePalette.length === 0) {
			// Try to get theme.json settings via the block editor
			const blockEditorStore = data.select("core/block-editor");
			if (blockEditorStore && typeof blockEditorStore.getSettings === "function") {
				const editorSettings = blockEditorStore.getSettings();
				console.log("Block editor settings:", editorSettings);

				if (editorSettings?.colors) {
					themePalette = editorSettings.colors;
				}
				if (editorSettings?.__experimentalFeatures?.color?.palette) {
					const featurePalette = editorSettings.__experimentalFeatures.color.palette;
					if (featurePalette.theme) {
						themePalette = featurePalette.theme;
					}
					if (featurePalette.custom) {
						customPalette = featurePalette.custom;
					}
					if (Array.isArray(featurePalette)) {
						themePalette = featurePalette;
					}
				}
			}
		}

		palette = [...themePalette, ...customPalette];
		console.log("Final palette:", palette);

		return {
			palette,
			themePalette,
			customPalette,
			rawSettings,
		};
	} catch (error) {
		console.error("Error getting current global styles:", error);
		return { palette: [], error: error.message };
	}
}

/**
 * Update the global color palette in real-time (preview mode - doesn't auto-save)
 *
 * @param {Array}   colors     Array of color objects: [{ slug: string, color: string, name: string }]
 * @param {boolean} replaceAll If true, replace entire custom palette. If false, merge with existing.
 * @return {Promise<Object>} Result object with success status, updated palette, and undo data
 */
export async function updateGlobalPalette(colors, replaceAll = false) {
	const data = getWPData();
	if (!data) {
		return {
			success: false,
			error: "WordPress data store not available. Make sure you're in the Site Editor.",
		};
	}

	try {
		const coreStore = data.select("core");
		const coreDispatch = data.dispatch("core");
		const globalStylesId = getGlobalStylesId();

		console.log("Updating global palette with ID:", globalStylesId);
		console.log("Colors to update:", colors);

		if (!globalStylesId) {
			return {
				success: false,
				error: "Could not find global styles. Make sure you're in the Site Editor.",
			};
		}

		// Get current record
		const currentRecord = coreStore.getEditedEntityRecord("root", "globalStyles", globalStylesId);
		console.log("Current record:", currentRecord);

		if (!currentRecord) {
			return {
				success: false,
				error: "Could not load current global styles.",
			};
		}

		// Capture original state for undo BEFORE making any changes
		const originalStyles = JSON.parse(JSON.stringify(currentRecord.settings || {}));

		// Build the new settings
		const currentSettings = currentRecord.settings || {};
		const currentColorSettings = currentSettings.color || {};
		const currentPalette = currentColorSettings.palette || {};

		// Get existing custom palette - handle different structures
		let existingCustomPalette = [];
		if (Array.isArray(currentPalette.custom)) {
			existingCustomPalette = currentPalette.custom;
		} else if (Array.isArray(currentPalette)) {
			// Some themes use flat palette structure
			existingCustomPalette = [];
		}

		// Also get theme palette for reference
		const themePalette = currentPalette.theme || [];
		console.log("Existing custom palette:", existingCustomPalette);
		console.log("Theme palette:", themePalette);

		// Validate and prepare new colors
		const validatedColors = colors
			.filter((c) => c.slug && c.color)
			.map((c) => ({
				slug: c.slug,
				color: c.color,
				name: c.name || c.slug.charAt(0).toUpperCase() + c.slug.slice(1).replace(/-/g, " "),
			}));

		if (validatedColors.length === 0) {
			return {
				success: false,
				error: "No valid colors provided. Each color needs a slug and color value.",
			};
		}

		let newCustomPalette;
		if (replaceAll) {
			newCustomPalette = validatedColors;
		} else {
			// Merge: update existing by slug, add new ones
			// Start with existing custom palette
			const paletteBySlug = new Map(existingCustomPalette.map((c) => [c.slug, c]));

			// Update/add new colors
			for (const newColor of validatedColors) {
				paletteBySlug.set(newColor.slug, newColor);
			}

			newCustomPalette = Array.from(paletteBySlug.values());
		}

		console.log("New custom palette:", newCustomPalette);

		// Build new settings object - preserve theme palette structure
		const newSettings = {
			...currentSettings,
			color: {
				...currentColorSettings,
				palette: {
					theme: themePalette, // Preserve theme palette
					custom: newCustomPalette,
				},
			},
		};

		console.log("New settings:", newSettings);

		// Update the entity record (this makes it appear immediately in the editor as a PREVIEW)
		// Note: We do NOT save here - user must click Accept to save
		await coreDispatch.editEntityRecord("root", "globalStyles", globalStylesId, {
			settings: newSettings,
		});

		console.log("Entity record updated (preview mode - not saved yet)");

		return {
			success: true,
			updatedColors: validatedColors,
			currentPalette: newCustomPalette,
			message: `Updated ${validatedColors.length} color(s) in the global palette. Click Accept to save or Decline to revert.`,
			// Include undo data for accept/decline functionality
			undoData: {
				globalStyles: {
					originalStyles,
					globalStylesId,
				},
			},
		};
	} catch (error) {
		console.error("Error updating global palette:", error);
		return {
			success: false,
			error: `Failed to update palette: ${error.message}`,
		};
	}
}

/**
 * Check if we're in an environment where global styles can be edited
 * @return {boolean} True if global styles editing is available
 */
export function isGlobalStylesAvailable() {
	const data = getWPData();
	if (!data) {
		return false;
	}

	try {
		// Check if we have access to the core store and global styles
		const coreStore = data.select("core");
		return typeof coreStore.getEditedEntityRecord === "function";
	} catch {
		return false;
	}
}

/**
 * Get a formatted list of current palette colors for display
 * @return {Array} Array of formatted color strings
 */
export function getFormattedPalette() {
	const { palette } = getCurrentGlobalStyles();
	return palette.map((c) => `${c.name || c.slug}: ${c.color}`);
}

export default {
	getGlobalStylesId,
	getCurrentGlobalStyles,
	updateGlobalPalette,
	isGlobalStylesAvailable,
	getFormattedPalette,
};
