/**
 * WordPress dependencies
 */
import { parse, serialize, createBlock } from "@wordpress/blocks";

/**
 * Validate that a string is valid WordPress block markup.
 *
 * Checks for block comments, parsability, and non-freeform blocks.
 * Returns parsed blocks on success so callers can skip re-parsing.
 *
 * @param {string} blockContent The block markup string to validate
 * @return {Object} { valid: boolean, blocks?: Array, error?: string }
 */
export const validateBlockMarkup = (blockContent) => {
	if (!blockContent || typeof blockContent !== "string") {
		return { valid: false, error: "block_content is empty or not a string" };
	}

	// Must contain block comments
	if (!blockContent.includes("<!-- wp:")) {
		return { valid: false, error: "Missing block comments (<!-- wp:... -->)" };
	}

	// Must parse to valid blocks
	let parsed;
	try {
		parsed = parse(blockContent);
	} catch (e) {
		return { valid: false, error: `Failed to parse block markup: ${e.message}` };
	}

	if (!parsed || parsed.length === 0) {
		return { valid: false, error: "Block markup parsed to zero blocks" };
	}

	// Filter out freeform/null blocks which indicate parsing issues
	const validBlocks = parsed.filter((b) => b.name !== "core/freeform" && b.name !== null);
	if (validBlocks.length === 0) {
		return {
			valid: false,
			error: "No valid blocks found — markup parsed only to freeform/null blocks",
		};
	}

	// Check that parsed blocks are structurally valid (save content matches block schema).
	// Catches mangled self-closing blocks (e.g. social-link expanded into open/close pairs).
	const invalidBlockNames = [];
	const checkBlockValidity = (blocks) => {
		for (const block of blocks) {
			if (block.isValid === false && block.name && block.name !== "core/freeform") {
				invalidBlockNames.push(block.name);
			}
			if (block.innerBlocks?.length > 0) {
				checkBlockValidity(block.innerBlocks);
			}
		}
	};
	checkBlockValidity(parsed);
	if (invalidBlockNames.length > 0) {
		// Auto-correct: re-create blocks from parsed attributes and re-serialize.
		// WordPress's createBlock + serialize produces correct HTML (class order,
		// meta-classes like has-text-color/has-background) from the JSON attributes.
		try {
			const recreate = (block) => {
				const innerBlocks = (block.innerBlocks || []).map(recreate);
				return createBlock(block.name, block.attributes || {}, innerBlocks);
			};
			const correctedBlocks = parsed.map(recreate);
			const correctedContent = serialize(correctedBlocks);

			// Verify the corrected content is actually valid
			const reParsed = parse(correctedContent);
			const stillInvalid = [];
			const recheck = (blocks) => {
				for (const b of blocks) {
					if (b.isValid === false && b.name && b.name !== "core/freeform") {
						stillInvalid.push(b.name);
					}
					if (b.innerBlocks?.length > 0) {
						recheck(b.innerBlocks);
					}
				}
			};
			recheck(reParsed);

			if (stillInvalid.length === 0) {
				// eslint-disable-next-line no-console
				console.log(
					"[blockValidator] Auto-corrected markup for:",
					[...new Set(invalidBlockNames)].join(", ")
				);
				return { valid: true, blocks: reParsed, correctedContent };
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[blockValidator] Auto-correction failed:", e);
		}

		const uniqueNames = [...new Set(invalidBlockNames)];
		return {
			valid: false,
			error: `Block validation failed for: ${uniqueNames.join(", ")}. The markup structure does not match what WordPress expects. Common causes: (1) self-closing blocks like social-link, navigation, site-logo must use <!-- wp:block-name {attrs} /--> syntax (NOT open/close pairs with HTML), (2) inner block content was rewritten instead of preserved exactly. Re-read the original markup with blu/get-block-markup and only change the specific attributes requested.`,
		};
	}

	// Check for conflicting preset + custom font-size (preset wins via CSS specificity, custom is ignored)
	const commentMatch = blockContent.match(/<!-- wp:\S+\s+(\{[\s\S]*?\})\s*-->/);
	if (commentMatch) {
		try {
			const attrs = JSON.parse(commentMatch[1]);
			if (attrs.fontSize && attrs.style?.typography?.fontSize) {
				return {
					valid: false,
					error: `Conflicting font size: found both "fontSize":"${attrs.fontSize}" (preset) and "style.typography.fontSize":"${attrs.style.typography.fontSize}" (custom). The preset class wins and the custom value is ignored. Remove the "fontSize" attribute and the has-${attrs.fontSize}-font-size class, then keep only the custom style.typography.fontSize value.`,
				};
			}
		} catch {
			// JSON parse failed — skip this check
		}
	}

	// Check for invalid gradient usage in inline styles
	const hasInvalidGradient =
		blockContent.includes("background-image:") && blockContent.includes("linear-gradient");
	if (hasInvalidGradient) {
		return {
			valid: false,
			error:
				"Invalid gradient: Do not use background-image in inline styles. Use style.color.gradient in block comment attrs and background: (not background-image:) in the style attribute. Add has-background class.",
		};
	}

	return { valid: true, blocks: parsed };
};
