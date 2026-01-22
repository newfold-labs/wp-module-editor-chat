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
					return settings.__experimentalGlobalStylesUserEntityId;
				}
			}
			// Try getEditedPostId for global styles
			if (typeof editSiteStore.getEditedPostId === "function") {
				const postId = editSiteStore.getEditedPostId();
				const postType = editSiteStore.getEditedPostType?.();
				if (postType === "wp_global_styles" && postId) {
					return postId;
				}
			}
		}

		// Method 3: Get from entity records
		const records = coreStore.getEntityRecords("root", "globalStyles", { per_page: 1 });
		if (records && records.length > 0) {
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
 * Update global styles using the full settings object (theme.json format)
 *
 * @param {Object} settings Settings object in theme.json format (e.g., { color: { palette: { custom: [...] } } })
 * @param {Object} styles   Optional styles object for CSS declarations
 * @return {Promise<Object>} Result object with success status and undo data
 */
export async function updateGlobalStyles(settings, styles = null) {
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

		if (!globalStylesId) {
			return {
				success: false,
				error: "Could not find global styles. Make sure you're in the Site Editor.",
			};
		}

		// Get current record
		const currentRecord = coreStore.getEditedEntityRecord("root", "globalStyles", globalStylesId);

		if (!currentRecord) {
			return {
				success: false,
				error: "Could not load current global styles.",
			};
		}

		// Capture original state for undo BEFORE making any changes
		const originalStyles = JSON.parse(JSON.stringify(currentRecord.settings || {}));
		const originalCssStyles = JSON.parse(JSON.stringify(currentRecord.styles || {}));

		// Deep merge new settings with current settings
		const currentSettings = currentRecord.settings || {};
		const newSettings = deepMerge(currentSettings, settings);

		// Prepare update data
		const updateData = { settings: newSettings };

		// Handle styles if provided
		if (styles) {
			const currentCssStyles = currentRecord.styles || {};
			updateData.styles = deepMerge(currentCssStyles, styles);
		}

		// Update the entity record (preview mode - user must click Accept to save)
		await coreDispatch.editEntityRecord("root", "globalStyles", globalStylesId, updateData);

		// Extract updated colors for the response message
		const updatedColors = settings?.color?.palette?.custom || [];
		const colorCount = updatedColors.length;
		const hasTypography = !!settings?.typography;
		const hasSpacing = !!settings?.spacing;

		let message = "Updated global styles.";
		if (colorCount > 0) {
			message = `Updated ${colorCount} color(s) in the global palette.`;
		}
		if (hasTypography) {
			message += " Typography settings updated.";
		}
		if (hasSpacing) {
			message += " Spacing settings updated.";
		}
		message += " Click Accept to save or Decline to revert.";

		return {
			success: true,
			updatedColors,
			message,
			undoData: {
				globalStyles: {
					originalStyles,
					originalCssStyles,
					globalStylesId,
				},
			},
		};
	} catch (error) {
		console.error("Error updating global styles:", error);
		return {
			success: false,
			error: `Failed to update global styles: ${error.message}`,
		};
	}
}

/**
 * Deep merge two objects
 * @param {Object} target Target object
 * @param {Object} source Source object to merge
 * @return {Object} Merged object
 */
function deepMerge(target, source) {
	const output = { ...target };

	for (const key of Object.keys(source)) {
		if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
			if (target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
				output[key] = deepMerge(target[key], source[key]);
			} else {
				output[key] = { ...source[key] };
			}
		} else {
			output[key] = source[key];
		}
	}

	return output;
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

export default {
	getGlobalStylesId,
	getCurrentGlobalStyles,
	updateGlobalStyles,
	isGlobalStylesAvailable,
};
