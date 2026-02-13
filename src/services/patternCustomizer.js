/* eslint-disable no-undef, no-console */
/**
 * Pattern content customization.
 *
 * Parses a pattern's block markup, extracts human-readable text blocks,
 * and rewrites them via a lightweight AI call so the content fits the page.
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

/**
 * Customize pattern text via a background AI completion.
 *
 * Parses the pattern, extracts text blocks, rewrites their content via a
 * lightweight AI call, then applies the changes via string replacement on
 * the **original** markup — no re-serialization, so layout / styles / attrs
 * are guaranteed to remain untouched.
 *
 * @param {string} patternMarkup   Original block markup from the library.
 * @param {Object} ctx             Context for the AI.
 * @param {string} ctx.pageTitle   Current page title.
 * @param {string} ctx.userMessage The user's original request.
 * @param {Object} openaiClient    OpenAI client instance (dependency injection).
 * @return {Promise<string>} Customized markup (or original on failure).
 */
export async function customizePatternContent(patternMarkup, ctx, openaiClient) {
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

	// Build items for AI — send trimmed HTML so the AI works with clean snippets
	const textItems = textBlocks.map((block, idx) => ({
		id: idx,
		type: getBlockName(block).replace("core/", ""),
		html: getBlockHTML(block).trim(),
	}));

	try {
		const response = await openaiClient.createChatCompletion({
			messages: [
				{
					role: "system",
					content:
						"You customize website pattern text. The blocks below are from a template with placeholder content. " +
						"Rewrite ALL human-readable text so it fits the website and page context. " +
						"Keep every HTML tag, class, attribute, and href value identical — change ONLY the text between/inside tags. " +
						"Keep the same approximate length and tone for each block. " +
						"Return a JSON array with `id` and `html` fields. Return ONLY the JSON array, nothing else.",
				},
				{
					role: "user",
					content:
						`Page: "${ctx.pageTitle}"\n` +
						`Request: "${ctx.userMessage}"\n\n` +
						`Text blocks:\n${JSON.stringify(textItems, null, 2)}`,
				},
			],
			temperature: 0.7,
			max_tokens: 4000,
		});

		const raw = response.choices?.[0]?.message?.content;
		if (!raw) {
			return patternMarkup;
		}

		const jsonMatch = raw.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return patternMarkup;
		}

		const customized = JSON.parse(jsonMatch[0]);

		// Apply replacements to the original markup via string substitution.
		// Each block's HTML is an exact substring of the original markup, so indexOf works.
		let result = patternMarkup;
		let searchFrom = 0;

		for (const item of customized) {
			const block = textBlocks[item.id];
			if (!block || !item.html) {
				continue;
			}

			const oldInner = getBlockHTML(block);
			// Preserve the original leading/trailing whitespace, swap only the trimmed content
			const newInner = oldInner.replace(oldInner.trim(), item.html.trim());

			const pos = result.indexOf(oldInner, searchFrom);
			if (pos !== -1) {
				result = result.substring(0, pos) + newInner + result.substring(pos + oldInner.length);
				searchFrom = pos + newInner.length;
			}
		}

		return result;
	} catch (err) {
		console.warn("[customizePatternContent] AI customization failed, using original:", err);
		return patternMarkup;
	}
}
