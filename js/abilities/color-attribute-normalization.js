function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function collectPaletteSlugs(value, slugs) {
	if (Array.isArray(value)) {
		value.forEach((item) => collectPaletteSlugs(item, slugs));
		return;
	}
	if (!isPlainObject(value)) {
		return;
	}
	if (typeof value.slug === "string" && typeof value.color === "string") {
		slugs.add(value.slug);
	}
	Object.values(value).forEach((item) => collectPaletteSlugs(item, slugs));
}

function getRegisteredColorSlugs() {
	const slugs = new Set();
	try {
		const settings = window.wp?.data?.select?.("core/block-editor")?.getSettings?.() || {};
		collectPaletteSlugs(settings.colors, slugs);
		collectPaletteSlugs(settings.__experimentalFeatures?.color?.palette, slugs);
	} catch {
		// Color settings are optional. CSS-value detection below is still safe.
	}
	return slugs;
}

function isCssColor(value) {
	if (typeof value !== "string" || !value.trim()) {
		return false;
	}
	try {
		if (window.CSS?.supports) {
			return window.CSS.supports("color", value);
		}
	} catch {
		// Fall through to the conservative syntax check.
	}
	return /^(?:#(?:[\da-f]{3,8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|var)\(|transparent$|currentcolor$|pink$)/i.test(
		value.trim()
	);
}

/**
 * Move literal CSS colors out of WordPress preset attributes.
 *
 * `backgroundColor` and `textColor` hold palette slugs, not arbitrary CSS
 * values. Gutenberg accepts an unknown value such as "pink", but emits a
 * preset class for which no CSS exists. Store literals in style.color instead.
 *
 * @param {Object} patch Attribute patch.
 * @return {Object} Normalized attribute patch.
 */
export function normalizeColorAttributeValues(patch) {
	if (!isPlainObject(patch)) {
		return patch;
	}

	const registeredSlugs = getRegisteredColorSlugs();
	const normalized = { ...patch };
	const pairs = [
		["textColor", "text"],
		["backgroundColor", "background"],
	];

	for (const [presetKey, customKey] of pairs) {
		const value = normalized[presetKey];
		if (typeof value === "string" && value.trim() === "") {
			normalized[presetKey] = null;
			continue;
		}
		if (typeof value !== "string" || registeredSlugs.has(value) || !isCssColor(value)) {
			continue;
		}

		const style = isPlainObject(normalized.style) ? normalized.style : {};
		const color = isPlainObject(style.color) ? style.color : {};
		normalized.style = {
			...style,
			color: {
				...color,
				...(Object.prototype.hasOwnProperty.call(color, customKey) ? {} : { [customKey]: value }),
			},
		};
		delete normalized[presetKey];
	}

	return normalized;
}
