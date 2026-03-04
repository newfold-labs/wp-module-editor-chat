/**
 * WordPress dependencies
 */
import { parse, serialize, createBlock } from "@wordpress/blocks";

/**
 * Validate and normalize a string of WordPress block markup.
 *
 * After basic sanity checks (non-empty, parsable, contains real blocks),
 * every block is recreated via `createBlock()` and re-serialized.  This
 * guarantees the HTML matches what WordPress's `save()` function produces
 * — correct class order, meta-classes, inline styles — regardless of
 * whatever the AI actually sent.
 *
 * @param {string} blockContent The block markup string to validate
 * @return {Object} { valid: boolean, blocks?: Array, correctedContent?: string, error?: string }
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

	// ── Always normalize ──
	// Recreate every block via createBlock() + serialize() so the HTML is
	// exactly what WordPress's save() function produces.  The AI only needs
	// to get the block comment JSON attributes right — the HTML is rebuilt.
	try {
		const recreate = (block) => {
			const innerBlocks = (block.innerBlocks || []).map(recreate);
			return createBlock(block.name, block.attributes || {}, innerBlocks);
		};
		const normalizedBlocks = parsed.map(recreate);
		const normalizedContent = serialize(normalizedBlocks);

		// Re-parse to verify the normalized content is valid
		const reParsed = parse(normalizedContent);
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

		if (stillInvalid.length > 0) {
			const uniqueNames = [...new Set(stillInvalid)];
			return {
				valid: false,
				error: `Block validation failed for: ${uniqueNames.join(", ")}. Re-read the original markup with blu/get-block-markup and only change the specific attributes requested.`,
			};
		}

		// eslint-disable-next-line no-console
		console.log("[blockValidator] Normalized markup");
		return { valid: true, blocks: reParsed, correctedContent: normalizedContent };
	} catch (e) {
		return { valid: false, error: `Block normalization failed: ${e.message}` };
	}
};
