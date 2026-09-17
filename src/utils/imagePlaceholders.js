/**
 * imagePlaceholders — the `__IMG_N__` contract shared by every write path.
 *
 * The model emits `__IMG_1__`, `__IMG_2__`, … inside block_content plus one
 * `image_prompts` entry per placeholder; the client swaps the tokens for real
 * URLs.
 */

import { setAltForImageSrc } from "./imageAlt";

/**
 * Matches the documented form plus the near-misses seen in practice: bare
 * `__IMG__`, `__IMG1__`, `__IMAGE_2__`, any casing. A miss ships a broken
 * <img> to the page; a false positive costs one retry.
 */
const PLACEHOLDER_SOURCE = "__(?:IMG|IMAGE)_?\\d*__";

/**
 * A fresh regex per call — a shared /g one carries `lastIndex` between calls.
 *
 * @return {RegExp} Global, case-insensitive placeholder matcher.
 */
function matcher() {
	return new RegExp(PLACEHOLDER_SOURCE, "gi");
}

/**
 * Every distinct placeholder token in `markup`, in order of first appearance.
 *
 * Order, not the digits in the token: models skip, repeat and restart the
 * numbering, while `image_prompts` is specified as one entry per placeholder
 * in order.
 *
 * @param {string} markup Block markup.
 * @return {string[]} Distinct tokens, first-appearance order.
 */
export function findImagePlaceholders(markup) {
	return markup ? [...new Set(markup.match(matcher()) ?? [])] : [];
}

/**
 * Whether a string still carries an unresolved placeholder.
 *
 * @param {string} value Markup, or a single attribute value.
 * @return {boolean} True when at least one placeholder remains.
 */
export function hasImagePlaceholder(value) {
	return typeof value === "string" && matcher().test(value);
}

/**
 * Whether a placeholder appears anywhere in a value tree — not just a bare
 * string, but any depth inside a plain object/array (e.g. an attribute patch
 * like `{ style: { backgroundImage: "url(__IMG_1__)" } }`, where the token is
 * nested well below the top-level `url` field the single-image callers
 * usually check).
 *
 * @param {*} value Any JSON-safe value.
 * @return {boolean} True when at least one placeholder remains anywhere in the tree.
 */
export function hasImagePlaceholderDeep(value) {
	if (typeof value === "string") {
		return hasImagePlaceholder(value);
	}
	if (Array.isArray(value)) {
		return value.some((item) => hasImagePlaceholderDeep(item));
	}
	if (value && typeof value === "object") {
		return Object.values(value).some((v) => hasImagePlaceholderDeep(v));
	}
	return false;
}

/**
 * Recursively replace every placeholder token inside a value tree with `url`.
 * Unlike {@link substituteImagePlaceholders} (markup + alt rewriting for a
 * single HTML string), this walks a plain object/array of attributes and
 * swaps the token wherever it appears — a nested CSS value included — since
 * an attribute patch has no single "markup string" to operate on.
 *
 * @param {*}      value Any JSON-safe value.
 * @param {string} url   The single generated image URL to substitute.
 * @return {*} A value of the same shape with every placeholder replaced.
 */
export function substituteImagePlaceholdersInValue(value, url) {
	if (typeof value === "string") {
		return hasImagePlaceholder(value) ? value.replace(matcher(), url) : value;
	}
	if (Array.isArray(value)) {
		return value.map((item) => substituteImagePlaceholdersInValue(item, url));
	}
	if (value && typeof value === "object") {
		const result = {};
		for (const [key, val] of Object.entries(value)) {
			result[key] = substituteImagePlaceholdersInValue(val, url);
		}
		return result;
	}
	return value;
}

/**
 * Swap placeholders for generated images, pairing them by position.
 *
 * The token stands in for the URL alone, so the surrounding `alt` was written
 * before the image existed and is rewritten here.
 *
 * @param {string}                             markup Block markup.
 * @param {Array<{url: string, alt?: string}>} images Images, in placeholder order.
 * @return {string} Markup with as many placeholders resolved as there were images.
 */
export function substituteImagePlaceholders(markup, images) {
	if (!markup || !images?.length) {
		return markup;
	}
	const tokens = findImagePlaceholders(markup);
	let resolved = markup;
	for (let i = 0; i < Math.min(tokens.length, images.length); i++) {
		const { url, alt } = images[i];
		if (!url) {
			continue;
		}
		resolved = resolved.replaceAll(tokens[i], url);
		if (alt) {
			resolved = setAltForImageSrc(resolved, url, alt);
		}
	}
	return resolved;
}
