/**
 * imageAlt — alt text for AI-generated images.
 *
 * The model is asked for real alt text (it knows what the image is for). When it
 * doesn't supply any we fall back to the generation prompt, which reads worse
 * but still describes the NEW image, whereas leaving the old value describes an
 * image no longer on the page.
 */

/** Longest alt text we emit. Screen readers commonly truncate beyond this. */
const MAX_ALT_LENGTH = 125;

/**
 * Escape a string for safe use inside a double-quoted HTML attribute.
 *
 * @param {string} value Raw text
 * @return {string} Escaped text
 */
function escapeAttribute(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/**
 * Resolve alt text for a generated image: the model's if it gave one, otherwise
 * the prompt. Capped here rather than by the ability schema, so an over-long
 * value is trimmed instead of failing the whole image call.
 *
 * @param {string} [alt]    Alt text supplied by the model
 * @param {string} [prompt] Prompt the image was generated from
 * @return {string} Alt text, or "" when neither yields anything
 */
export function resolveAlt(alt, prompt) {
	let text = (alt?.trim() || prompt?.trim() || "").replace(/\s+/g, " ");
	if (text.length > MAX_ALT_LENGTH) {
		const clipped = text.slice(0, MAX_ALT_LENGTH);
		const lastSpace = clipped.lastIndexOf(" ");
		text = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
	}
	return text.replace(/[\s,;:.\-–—]+$/, "");
}

/**
 * Set the alt attribute on every <img> in `markup` whose src matches `url`.
 *
 * Placeholder substitution swaps only the URL, so without this the surrounding
 * alt keeps describing whatever the markup was written against.
 *
 * @param {string} markup Block markup
 * @param {string} url    src value identifying the image to update
 * @param {string} alt    Alt text to apply
 * @return {string} Markup with alt applied
 */
export function setAltForImageSrc(markup, url, alt) {
	if (!markup || !url || !alt) {
		return markup;
	}
	const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const matchesSrc = new RegExp(`src=["']${escapedUrl}["']`, "i");
	const value = escapeAttribute(alt);

	// Replacer functions, not strings: `$&`, `` $` `` and `$'` in alt text would
	// otherwise be read as replacement patterns and corrupt the markup.
	return markup.replace(/<img\b[^>]*>/gi, (tag) => {
		if (!matchesSrc.test(tag)) {
			return tag;
		}
		return /\balt\s*=\s*["'][^"']*["']/i.test(tag)
			? tag.replace(/\balt\s*=\s*["'][^"']*["']/i, () => `alt="${value}"`)
			: tag.replace(/<img\b/i, () => `<img alt="${value}"`);
	});
}
