/**
 * imageAlt — alt text for AI-generated images.
 *
 * The model is asked to supply real alt text (it knows what the image is for),
 * but it does not always do so. When it doesn't, we fall back to the generation
 * prompt: imperfect, but a prompt describes the NEW image, whereas leaving the
 * old value describes an image that is no longer on the page.
 */

/** Longest alt text we emit. Screen readers commonly truncate beyond this. */
const MAX_ALT_LENGTH = 125;

/**
 * Trailing prompt clauses that describe rendering rather than subject matter,
 * e.g. "…, cinematic, 35mm, shallow depth of field". Deliberately limited to
 * unambiguously technical terms — words like "modern" or "clean" are just as
 * likely to describe the subject, so they are left alone.
 */
const STYLE_CLAUSE = new RegExp(
	`^(${[
		"cinematic",
		"photorealistic",
		"hyper-?realistic",
		"4k|8k|hd|uhd",
		"high[- ]?res(olution)?",
		"bokeh",
		"(shallow )?depth of field",
		"(golden|blue) hour",
		"(studio|soft|natural|dramatic) lighting",
		"studio shot",
		"wide[- ]angle",
		"close[- ]?up",
		"macro",
		"telephoto",
		"\\d+\\s*mm",
		"f/?\\d+(\\.\\d+)?",
		"iso\\s*\\d+",
		"sharp focus",
		"(highly|ultra[- ])detailed",
		"award[- ]winning",
		"stock photo(graphy)?",
		"no (text|watermark)",
	].join("|")})$`,
	"i"
);

/** Leading filler such as "a photo of" / "a high quality image showing". */
const LEAD_IN =
	/^(an?\s+)?(\w+\s+){0,2}(photo|photograph|image|picture|illustration|render|shot|graphic)\s+(of|showing|depicting)\s+/i;

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
 * Cap alt text at a readable length, breaking on a word boundary.
 *
 * @param {string} text Alt text
 * @return {string} Capped text
 */
function truncateAlt(text) {
	let out = text;
	if (out.length > MAX_ALT_LENGTH) {
		const clipped = out.slice(0, MAX_ALT_LENGTH);
		const lastSpace = clipped.lastIndexOf(" ");
		out = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
	}
	return out.replace(/[\s,;:.\-–—]+$/, "");
}

/**
 * Turn an image-generation prompt into usable alt text.
 *
 * @param {string} prompt The prompt the image was generated from
 * @return {string} Alt text, or "" when nothing usable remains
 */
export function deriveAltFromPrompt(prompt) {
	if (typeof prompt !== "string" || !prompt.trim()) {
		return "";
	}

	// Drop trailing style clauses, right to left, so subject matter survives.
	const parts = prompt.split(",").map((part) => part.trim());
	while (parts.length > 1 && STYLE_CLAUSE.test(parts[parts.length - 1])) {
		parts.pop();
	}

	let text = parts.join(", ").replace(LEAD_IN, "").trim();
	if (!text) {
		return "";
	}

	text = truncateAlt(text);
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Resolve the alt text for a generated image: the model's if it gave one,
 * otherwise derived from the prompt.
 *
 * @param {string} [alt]    Alt text supplied by the model
 * @param {string} [prompt] Prompt the image was generated from
 * @return {string} Alt text, or "" when neither yields anything
 */
export function resolveAlt(alt, prompt) {
	const supplied = alt?.trim();
	return supplied ? truncateAlt(supplied) : deriveAltFromPrompt(prompt);
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

	return markup.replace(/<img\b[^>]*>/gi, (tag) => {
		if (!matchesSrc.test(tag)) {
			return tag;
		}
		return /\balt\s*=\s*["'][^"']*["']/i.test(tag)
			? tag.replace(/\balt\s*=\s*["'][^"']*["']/i, `alt="${value}"`)
			: tag.replace(/<img\b/i, `<img alt="${value}"`);
	});
}
