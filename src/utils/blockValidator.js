/**
 * WordPress dependencies
 */
import { parse, serialize, createBlock } from "@wordpress/blocks";

/**
 * Count the total number of blocks (including all nested inner blocks)
 * in a flat or tree-shaped block array.
 *
 * @param {Array} blocks Array of parsed block objects
 * @return {number} Total block count
 */
function deepBlockCount(blocks) {
	let count = 0;
	for (const b of blocks) {
		if (b.name && b.name !== "core/freeform") {
			count++;
		}
		if (b.innerBlocks?.length > 0) {
			count += deepBlockCount(b.innerBlocks);
		}
	}
	return count;
}

/**
 * Check that every opening HTML tag in the markup has a matching closing tag.
 * Only checks block-relevant container tags (div, figure, figcaption, ul, ol, li,
 * blockquote, table, thead, tbody, tr, td, th, section, nav, header, footer, main, aside).
 * Self-closing tags (img, br, hr, input) are ignored.
 *
 * @param {string} markup The HTML markup to check
 * @return {{ balanced: boolean, details?: string }} Result with optional details on mismatch
 */
function checkTagBalance(markup) {
	// Strip block comments so they don't interfere with tag matching
	const html = markup.replace(/<!--[\s\S]*?-->/g, "");

	const containerTags = new Set([
		"div",
		"figure",
		"figcaption",
		"ul",
		"ol",
		"li",
		"blockquote",
		"table",
		"thead",
		"tbody",
		"tr",
		"td",
		"th",
		"section",
		"nav",
		"header",
		"footer",
		"main",
		"aside",
		"span",
		"p",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"a",
	]);

	const stack = [];
	// Match opening tags (with optional attributes) and closing tags
	const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g;
	let match;

	while ((match = tagRegex.exec(html)) !== null) {
		const fullTag = match[0];
		const tagName = match[1].toLowerCase();

		if (!containerTags.has(tagName)) {
			continue;
		}
		// Skip self-closing tags like <img />, <br />, etc.
		if (fullTag.endsWith("/>")) {
			continue;
		}

		if (fullTag.startsWith("</")) {
			// Closing tag
			if (stack.length === 0 || stack[stack.length - 1] !== tagName) {
				const expected = stack.length > 0 ? `</${stack[stack.length - 1]}>` : "nothing";
				return {
					balanced: false,
					details: `Unexpected closing tag </${tagName}>, expected ${expected}`,
				};
			}
			stack.pop();
		} else {
			// Opening tag
			stack.push(tagName);
		}
	}

	if (stack.length > 0) {
		const unclosed = stack
			.reverse()
			.map((t) => `</${t}>`)
			.join(", ");
		return {
			balanced: false,
			details: `Unclosed tags — missing: ${unclosed}`,
		};
	}

	return { balanced: true };
}

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

	// ── Pre-check: HTML tag balance ──
	// Catch malformed markup (e.g., missing closing </div>) before parse()
	// silently drops inner blocks.  This gives the AI a specific, fixable error.
	const balance = checkTagBalance(blockContent);
	if (!balance.balanced) {
		// eslint-disable-next-line no-console
		console.warn("[blockValidator] Tag balance check failed:", balance.details);
		return {
			valid: false,
			error: `Malformed HTML in block_content: ${balance.details}. Fix the markup and retry, or break the section into smaller tool calls.`,
		};
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

	// Snapshot block count before normalization for later comparison
	const preNormCount = deepBlockCount(parsed);

	// ── Auto-wrap blocks that require a parent wrapper ──
	// core/button must be inside core/buttons, core/list-item inside core/list.
	// The AI often sends bare child blocks without the required parent.
	const PARENT_WRAPPERS = {
		"core/button": "core/buttons",
		"core/list-item": "core/list",
	};
	for (let i = 0; i < parsed.length; i++) {
		const wrapper = PARENT_WRAPPERS[parsed[i].name];
		if (wrapper) {
			// Check if already wrapped (e.g., button inside buttons)
			const alreadyWrapped = parsed.some(
				(b, idx) =>
					idx !== i && b.name === wrapper && b.innerBlocks?.some((ib) => ib.name === parsed[i].name)
			);
			if (!alreadyWrapped) {
				// eslint-disable-next-line no-console
				console.log(`[blockValidator] Auto-wrapping ${parsed[i].name} in ${wrapper}`);
				const wrappedBlock = createBlock(wrapper, {}, [
					createBlock(parsed[i].name, parsed[i].attributes || {}, parsed[i].innerBlocks || []),
				]);
				parsed.splice(i, 1, wrappedBlock);
			}
		}
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

		// ── Post-normalization: check for silent content loss ──
		// If parse() → createBlock() → serialize() dropped blocks, the
		// original markup was structurally broken in a way the tag-balance
		// check didn't catch.  Reject instead of silently inserting
		// incomplete content.
		const postNormCount = deepBlockCount(reParsed);
		if (preNormCount > 0 && postNormCount < preNormCount) {
			const lost = preNormCount - postNormCount;
			// eslint-disable-next-line no-console
			console.warn(
				`[blockValidator] Normalization lost ${lost} of ${preNormCount} blocks (${postNormCount} remain)`
			);
			return {
				valid: false,
				error: `Normalization dropped ${lost} of ${preNormCount} inner blocks — the markup is too complex or malformed for a single tool call. Break it into smaller steps: (1) use blu-add-section to add a container, then (2) use additional blu-add-section calls with after_client_id or as_child_of to add inner content piece by piece.`,
			};
		}

		// eslint-disable-next-line no-console
		console.log("[blockValidator] Normalized markup");
		return { valid: true, blocks: reParsed, correctedContent: normalizedContent };
	} catch (e) {
		return { valid: false, error: `Block normalization failed: ${e.message}` };
	}
};
