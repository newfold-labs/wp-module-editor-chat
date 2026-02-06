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
	const hasInvalidGradient = blockContent.includes('background-image:') && blockContent.includes('linear-gradient');
	if (hasInvalidGradient) {
		return {
			valid: false,
			error: 'Invalid gradient: Do not use background-image in inline styles. Use style.color.gradient in block comment attrs and background: (not background-image:) in the style attribute. Add has-background class.',
		};
	}

	return { valid: true, blocks: parsed };
};
