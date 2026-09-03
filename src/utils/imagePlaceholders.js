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
