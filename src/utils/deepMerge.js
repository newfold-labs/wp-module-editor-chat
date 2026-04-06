/**
 * Deep-merge utilities.
 *
 * Two flavours are provided because block attributes and global styles
 * have different merge semantics:
 *
 * - deepMergeAttrs:  null/undefined values DELETE the key (block attrs)
 * - deepMergeStyles: slug-keyed arrays are merged by slug (global styles)
 */

/**
 * Deep-merge source into target.
 * Null/undefined values remove the key — useful for block attributes where
 * `{ "fontSize": null }` means "unset the preset size".
 * Arrays and non-plain-objects are replaced, not merged.
 *
 * @param {Object} target
 * @param {Object} source
 * @return {Object} Merged object
 */
export function deepMergeAttrs(target, source) {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (source[key] === null || source[key] === undefined) {
			delete result[key];
		} else if (
			typeof source[key] === "object" &&
			!Array.isArray(source[key]) &&
			typeof result[key] === "object" &&
			result[key] !== null &&
			!Array.isArray(result[key])
		) {
			result[key] = deepMergeAttrs(result[key], source[key]);
		} else {
			result[key] = source[key];
		}
	}
	return result;
}

/**
 * Check if an array consists of objects that each have a "slug" property.
 *
 * @param {Array} arr Array to check
 * @return {boolean} True if every item has a slug
 */
function isSlugArray(arr) {
	return (
		arr.length > 0 &&
		arr.every((item) => item && typeof item === "object" && typeof item.slug === "string")
	);
}

/**
 * Merge two arrays of slug-keyed objects.
 * Items in source update matching target items by slug.
 * Target items with no matching source slug are preserved.
 * Source items with no matching target slug are appended.
 *
 * @param {Array} target Existing array
 * @param {Array} source Incoming array
 * @return {Array} Merged array
 */
function mergeBySlug(target, source) {
	const sourceMap = new Map(source.map((item) => [item.slug, item]));
	const merged = target.map((item) =>
		sourceMap.has(item.slug) ? { ...item, ...sourceMap.get(item.slug) } : item
	);
	const existingSlugs = new Set(target.map((item) => item.slug));
	const newItems = source.filter((item) => !existingSlugs.has(item.slug));
	return [...merged, ...newItems];
}

/**
 * Deep-merge source into target with slug-aware array handling.
 * Arrays of objects with a "slug" property (e.g., palette.custom) are merged
 * by slug: matching entries are updated, unmatched are preserved, new ones appended.
 * All other arrays are replaced outright.
 *
 * @param {Object} target Target object
 * @param {Object} source Source object to merge
 * @return {Object} Merged object
 */
export function deepMergeStyles(target, source) {
	const output = { ...target };

	for (const key of Object.keys(source)) {
		const srcVal = source[key];
		const tgtVal = target[key];

		if (Array.isArray(srcVal) && Array.isArray(tgtVal) && isSlugArray(srcVal)) {
			output[key] = mergeBySlug(tgtVal, srcVal);
		} else if (srcVal && typeof srcVal === "object" && !Array.isArray(srcVal)) {
			if (tgtVal && typeof tgtVal === "object" && !Array.isArray(tgtVal)) {
				output[key] = deepMergeStyles(tgtVal, srcVal);
			} else {
				output[key] = { ...srcVal };
			}
		} else {
			output[key] = srcVal;
		}
	}

	return output;
}
