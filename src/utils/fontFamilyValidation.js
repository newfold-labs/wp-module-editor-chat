/**
 * Theme font preset validation for block attribute and global style patches.
 */
import { getCurrentGlobalStyles } from "../services/globalStylesService";

/**
 * @param {Object|null|undefined} attributes Attribute patch.
 * @return {string|null} Requested fontFamily slug, if any.
 */
export function getRequestedFontFamilySlug(attributes) {
	if (!attributes || typeof attributes !== "object") {
		return null;
	}
	if (typeof attributes.fontFamily === "string" && attributes.fontFamily.trim()) {
		return attributes.fontFamily.trim();
	}
	const styleFamily = attributes.style?.typography?.fontFamily;
	if (typeof styleFamily === "string" && styleFamily.trim()) {
		const trimmed = styleFamily.trim();
		const presetMatch = trimmed.match(/var:preset\|font-family\|([a-z0-9-]+)/i);
		if (presetMatch) {
			return presetMatch[1];
		}
		const cssVarMatch = trimmed.match(/--wp--preset--font-family--([a-z0-9-]+)/i);
		if (cssVarMatch) {
			return cssVarMatch[1];
		}
	}
	return null;
}

/**
 * WordPress preset class for block-level fontFamily attr (e.g. has-playfair-display-font-family).
 *
 * @param {string} slug Theme font preset slug.
 * @return {string|null} Class name or null when slug is invalid.
 */
export function buildHasFontFamilyClassName(slug) {
	if (!slug || typeof slug !== "string") {
		return null;
	}
	const trimmed = slug.trim();
	if (!/^[a-z0-9-]+$/i.test(trimmed)) {
		return null;
	}
	return `has-${trimmed}-font-family`;
}

/**
 * Ensure has-{slug}-font-family is present when fontFamily preset slug is set on a block patch.
 *
 * @param {Object} attributes        Patch attributes.
 * @param {string} existingClassName Current block className.
 * @return {Object} Patch with className updated when applicable.
 */
export function applyFontFamilyClassNameToAttributes(attributes, existingClassName = "") {
	if (!attributes || typeof attributes !== "object") {
		return attributes;
	}

	const slug = getRequestedFontFamilySlug(attributes);
	if (!slug) {
		return attributes;
	}

	const requiredClass = buildHasFontFamilyClassName(slug);
	if (!requiredClass) {
		return attributes;
	}

	const patchClass =
		typeof attributes.className === "string" ? attributes.className : existingClassName || "";
	const classTokens = patchClass.split(/\s+/).filter(Boolean);
	if (!classTokens.includes(requiredClass)) {
		classTokens.push(requiredClass);
	}

	const fontClassPattern = /^has-[a-z0-9-]+-font-family$/i;
	const withoutOtherFontClasses = classTokens.filter(
		(token) => !fontClassPattern.test(token) || token === requiredClass
	);

	return {
		...attributes,
		className: [...new Set(withoutOtherFontClasses)].join(" "),
	};
}

/**
 * Whether the current user may change site-wide global styles (typography/colors).
 *
 * @return {boolean} True when edit_theme_options was localized as allowed.
 */
export function userCanEditGlobalStyles() {
	if (typeof window === "undefined" || !window.nfdEditorChat) {
		return true;
	}
	return window.nfdEditorChat.canEditThemeOptions === true;
}

/**
 * Collect string values of typography.fontFamily in a theme.json-style styles tree.
 *
 * @param {Object|null|undefined} node   Styles node.
 * @param {string[]}              values Accumulator.
 * @return {string[]} Collected fontFamily values.
 */
export function collectTypographyFontFamilyValues(node, values = []) {
	if (!node || typeof node !== "object" || Array.isArray(node)) {
		return values;
	}

	if (typeof node.fontFamily === "string" && node.fontFamily.trim()) {
		values.push(node.fontFamily.trim());
	}

	for (const key of Object.keys(node)) {
		if (key === "fontFamily") {
			continue;
		}
		collectTypographyFontFamilyValues(node[key], values);
	}
	return values;
}

/**
 * Validate font family slugs / preset tokens in a global-styles patch.
 *
 * @param {Object|null|undefined} settings settings portion of the patch.
 * @param {Object|null|undefined} styles   styles portion of the patch.
 * @return {{ error: string, allowedSlugs: string[] }|null} Error payload or null when valid.
 */
export function validateGlobalStylesFontPatch(settings, styles) {
	const values = [];
	if (styles) {
		collectTypographyFontFamilyValues(styles, values);
	}
	if (settings?.typography && typeof settings.typography.fontFamily === "string") {
		values.push(settings.typography.fontFamily.trim());
	}

	for (const value of values) {
		const isPresetToken =
			value.includes("var:preset|font-family|") || value.includes("--wp--preset--font-family--");
		if (
			!isPresetToken &&
			typeof value === "string" &&
			value.trim() &&
			(value.includes(",") || /\s/.test(value))
		) {
			return {
				error:
					"Custom font stacks are not allowed in global styles — use var:preset|font-family|{slug} from Active theme font presets.",
				allowedSlugs: getCurrentGlobalStyles().fontFamilies?.map((f) => f.slug) || [],
			};
		}

		const asAttrs = isPresetToken
			? { style: { typography: { fontFamily: value } } }
			: { fontFamily: value };

		const err = validateThemeFontFamilySlug(asAttrs);
		if (err) {
			return err;
		}

		if (
			!getRequestedFontFamilySlug(asAttrs) &&
			typeof value === "string" &&
			value.trim() &&
			!value.includes("var:preset|font-family|") &&
			!value.includes("--wp--preset--font-family--")
		) {
			return {
				error:
					"Custom font stacks are not allowed in global styles — use var:preset|font-family|{slug} from Active theme font presets.",
				allowedSlugs: getCurrentGlobalStyles().fontFamilies?.map((f) => f.slug) || [],
			};
		}
	}

	return null;
}

/**
 * Reject fontFamily slugs that are not registered on the theme (when the list is known).
 *
 * @param {Object|null|undefined} attributes Attribute patch.
 * @return {{ error: string, allowedSlugs: string[] }|null} Error payload or null when valid.
 */
export function validateThemeFontFamilySlug(attributes) {
	const slug = getRequestedFontFamilySlug(attributes);
	if (!slug) {
		const customStack = attributes?.style?.typography?.fontFamily;
		if (
			typeof customStack === "string" &&
			customStack.trim() &&
			!customStack.includes("var:preset|font-family|") &&
			!customStack.includes("--wp--preset--font-family--")
		) {
			return {
				error:
					"Custom font stacks are not allowed — use a theme font preset slug in fontFamily (e.g. playfair-display).",
				allowedSlugs: [],
			};
		}
		return null;
	}

	const customStack = attributes?.style?.typography?.fontFamily;
	if (
		typeof customStack === "string" &&
		customStack.trim() &&
		!customStack.includes("var:preset|font-family|") &&
		!customStack.includes("--wp--preset--font-family--")
	) {
		return {
			error:
				"Custom font stacks are not allowed — use a theme font preset slug in fontFamily (e.g. playfair-display).",
			allowedSlugs: [],
		};
	}

	const { fontFamilies } = getCurrentGlobalStyles();
	if (!Array.isArray(fontFamilies) || fontFamilies.length === 0) {
		return null;
	}

	const allowed = fontFamilies.map((f) => f.slug);
	if (allowed.includes(slug)) {
		return null;
	}

	return {
		error: `Font preset "${slug}" is not in the active theme. Use one of: ${allowed.join(", ")}.`,
		allowedSlugs: allowed,
	};
}
