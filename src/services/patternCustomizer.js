/* eslint-disable no-undef */
/**
 * Pattern content customization.
 *
 * Parses a pattern's block markup, extracts human-readable text blocks,
 * rewrites them via a caller-provided completion function, then applies
 * the changes via string replacement on the original markup so layout,
 * styles, and attributes remain untouched.
 */

/**
 * Text-bearing block types whose content should be customized in patterns.
 */
const TEXT_BLOCK_TYPES = new Set([
	"core/heading",
	"core/paragraph",
	"core/button",
	"core/list-item",
]);

/**
 * Get the block name from a parsed block object.
 * wp.blocks.parse() returns `name`, the grammar parser returns `blockName`.
 *
 * @param {Object} block Parsed block object.
 * @return {string|null} Block name or null.
 */
function getBlockName(block) {
	return block.blockName || block.name || null;
}

/**
 * Get the raw HTML content from a parsed block object.
 * wp.blocks.parse() returns `originalContent`, the grammar parser returns `innerHTML`.
 *
 * @param {Object} block Parsed block object.
 * @return {string} HTML content string.
 */
function getBlockHTML(block) {
	return block.innerHTML || block.originalContent || "";
}

/**
 * Strip HTML tags and return plain text (preserves entities as-is).
 *
 * @param {string} html HTML string.
 * @return {string} Plain text.
 */
function stripTags(html) {
	return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Walk a parsed block tree and collect leaf text blocks.
 *
 * @param {Array} blocks Parsed blocks from wp.blocks.parse().
 * @param {Array} result Accumulator.
 * @return {Array} Flat list of text block references (with html accessor).
 */
function collectTextBlocks(blocks, result = []) {
	for (const block of blocks) {
		const name = getBlockName(block);
		const html = getBlockHTML(block);
		if (TEXT_BLOCK_TYPES.has(name) && html.trim()) {
			result.push(block);
		}
		if (block.innerBlocks?.length) {
			collectTextBlocks(block.innerBlocks, result);
		}
	}
	return result;
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Customize pattern text via a completion function.
 *
 * Parses the pattern, extracts text blocks, rewrites their content via
 * the provided completionFn, then applies the changes via string replacement
 * on the **original** markup — no re-serialization, so layout / styles /
 * attrs are guaranteed to remain untouched.
 *
 * Falls back to the original markup on any error (graceful degradation).
 *
 * @param {string}   patternMarkup   Original block markup from the library.
 * @param {Object}   ctx             Context for the AI.
 * @param {string}   ctx.pageTitle   Current page title.
 * @param {string}   ctx.userMessage The user's original request.
 * @param {Function} completionFn    Async function: (prompt: string) => string.
 * @return {Promise<string>} Customized markup (or original on failure).
 */
export async function customizePatternContent(patternMarkup, ctx, completionFn) {
	if (!completionFn) {
		return patternMarkup;
	}

	let blocks;
	try {
		blocks = wp.blocks.parse(patternMarkup);
	} catch {
		return patternMarkup;
	}

	const textBlocks = collectTextBlocks(blocks);
	if (textBlocks.length === 0) {
		return patternMarkup;
	}

	// Build items for AI — send plain text only (no HTML) to keep the
	// response small and avoid truncation from the model.
	const textItems = textBlocks.map((block, idx) => ({
		id: idx,
		type: getBlockName(block).replace("core/", ""),
		text: stripTags(getBlockHTML(block)),
	}));

	const site = window.nfdEditorChat?.site || {};

	try {
		const prompt =
			"Rewrite ALL text below to fit the website and page context. " +
			"Keep approximately the same length and tone. " +
			"Return ONLY a compact JSON array with `id` and `text` fields. " +
			"No HTML tags, no explanation, no markdown fences.\n\n" +
			`Site: "${site.title || ""}"\n` +
			(site.description ? `Description: "${site.description}"\n` : "") +
			(site.siteType ? `Type: ${site.siteType}\n` : "") +
			`Page: "${ctx.pageTitle || ""}"\n` +
			(ctx.userMessage ? `User request: "${ctx.userMessage}"\n` : "") +
			`\nText blocks:\n${JSON.stringify(textItems)}`;

		const raw = await completionFn(prompt);
		if (!raw) {
			return patternMarkup;
		}

		// Strip markdown fences if present
		const cleaned = raw
			.replace(/```json\s*/g, "")
			.replace(/```\s*/g, "")
			.trim();

		const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return patternMarkup;
		}

		const jsonStr = jsonMatch[0];

		let customized;
		try {
			customized = JSON.parse(jsonStr);
		} catch {
			// Try sanitizing control characters (literal newlines/tabs in strings)
			try {
				let sanitized = "";
				let inStr = false;
				let esc = false;
				for (let i = 0; i < jsonStr.length; i++) {
					const ch = jsonStr[i];
					if (esc) {
						sanitized += ch;
						esc = false;
						continue;
					}
					if (ch === "\\" && inStr) {
						sanitized += ch;
						esc = true;
						continue;
					}
					if (ch === '"') {
						inStr = !inStr;
						sanitized += ch;
						continue;
					}
					if (inStr && ch.charCodeAt(0) < 0x20) {
						if (ch === "\n") {
							sanitized += "\\n";
							continue;
						}
						if (ch === "\r") {
							sanitized += "\\r";
							continue;
						}
						if (ch === "\t") {
							sanitized += "\\t";
							continue;
						}
						continue;
					}
					sanitized += ch;
				}
				customized = JSON.parse(sanitized);
			} catch {
				// Last resort: extract id and text pairs individually
				customized = [];
				try {
					const items = jsonStr
						.replace(/^\[/, "")
						.replace(/\]$/, "")
						.split(/\},\s*\{/);
					for (const item of items) {
						const fixed =
							(item.startsWith("{") ? item : "{" + item) + (item.endsWith("}") ? "" : "}");
						try {
							customized.push(JSON.parse(fixed));
						} catch {
							const idMatch = fixed.match(/"id"\s*:\s*(\d+)/);
							const textMatch = fixed.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
							if (idMatch && textMatch) {
								customized.push({
									id: parseInt(idMatch[1], 10),
									text: textMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"),
								});
							}
						}
					}
				} catch {
					// ignore
				}

				if (customized.length === 0) {
					return patternMarkup;
				}
			}
		}

		// Apply replacements to the original markup via string substitution.
		// For each text block, find the old plain text inside the block's HTML
		// and replace it with the new text — all HTML tags/classes stay intact.
		let result = patternMarkup;
		let searchFrom = 0;

		for (const item of customized) {
			const block = textBlocks[item.id];
			if (!block || !item.text) {
				continue;
			}

			const oldInner = getBlockHTML(block);
			const oldText = stripTags(oldInner);
			if (!oldText) {
				continue;
			}

			// Replace the plain text inside the HTML, preserving all tags and whitespace
			const newInner = oldInner.replace(oldText, item.text.trim());

			const pos = result.indexOf(oldInner, searchFrom);
			if (pos !== -1) {
				result = result.substring(0, pos) + newInner + result.substring(pos + oldInner.length);
				searchFrom = pos + newInner.length;
			}
		}

		return result;
	} catch {
		return patternMarkup;
	}
}
