/**
 * WordPress dependencies
 */
import { parse } from "@wordpress/blocks";

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

	return { valid: true, blocks: parsed };
};
