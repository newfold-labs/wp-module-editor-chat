/**
 * imagePlaceholders — the `__IMG_N__` contract shared by every write path.
 *
 * The model is told to emit `__IMG_1__`, `__IMG_2__`, … inside block_content and
 * one `image_prompts` entry per placeholder; the client generates the images and
 * swaps the tokens for real URLs.
 *
 * Matching is deliberately looser than the documented form. A spelling we fail
 * to recognise is skipped for generation *and* slips past the unresolved-
 * placeholder guard, so the literal token lands in the page as a broken
 * <img src="__IMG__">. A false positive costs one retry; a miss ships a broken
 * image the user has to delete by hand.
 */

import { setAltForImageSrc } from "./imageAlt";

/**
 * `__IMG_1__` as documented, plus the near-misses seen in practice: a bare
 * `__IMG__` when there is only one image, `__IMG1__` without the separator,
 * `__IMAGE_2__`, and any casing.
 */
const PLACEHOLDER_SOURCE = "__(?:IMG|IMAGE)_?\\d*__";

/**
 * A fresh matcher per call — a shared /g regex carries `lastIndex` between
 * calls, which makes repeated `.test()` alternate true and false.
 *
 * @return {RegExp} Global, case-insensitive placeholder matcher.
 */
function matcher() {
	return new RegExp(PLACEHOLDER_SOURCE, "gi");
}

/**
 * Every distinct placeholder token in `markup`, in order of first appearance.
 *
 * Order, not the digits in the token: `image_prompts` is specified as "one entry
 * per placeholder, in order", and models skip, repeat, and restart the numbering.
 *
 * @param {string} markup Block markup.
 * @return {string[]} Distinct tokens, first-appearance order.
 */
export function findImagePlaceholders(markup) {
	if (!markup) {
		return [];
	}
	const tokens = [];
	for (const match of markup.matchAll(matcher())) {
		if (!tokens.includes(match[0])) {
			tokens.push(match[0]);
		}
	}
	return tokens;
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
 * before the image existed. It is rewritten here to describe the picture
 * actually used.
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
