/**
 * WordPress dependencies
 */
import { parse, serialize, createBlock } from "@wordpress/blocks";

/**
 * Internal dependencies
 */
import { findImagePlaceholders } from "./imagePlaceholders";
import logger from "./logger";

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
/**
 * Give core/list items their block delimiters.
 *
 * core/list keeps its items as core/list-item inner blocks, so bare <li>
 * children are discarded at parse. Only applies when no delimiters are present.
 *
 * @param {string} markup Raw block markup from the model.
 * @return {string} Markup with every <li> wrapped in core/list-item delimiters.
 */
function normalizeListItems(markup) {
	if (markup.includes("<!-- wp:list-item")) {
		return markup;
	}
	if (!markup.includes("<!-- wp:list") || !/<li[\s>]/i.test(markup)) {
		return markup;
	}
	const normalized = markup.replace(
		/<li(\s[^>]*)?>([\s\S]*?)<\/li>/gi,
		(_match, attrs, inner) =>
			`<!-- wp:list-item -->\n<li${attrs || ""}>${inner}</li>\n<!-- /wp:list-item -->`
	);
	logger.log("[blockValidator] Wrapped bare <li> items in core/list-item delimiters");
	return normalized;
}

/**
 * Rewrite `wp:row` as the group block it actually is.
 *
 * There is no core/row block type; "Row" is a core/group variation with a flex
 * layout, so `<!-- wp:row -->` parses as an unregistered block.
 *
 * @param {string} markup Raw block markup from the model.
 * @return {string} Markup with row blocks expressed as flex groups.
 */
function normalizeRowBlocks(markup) {
	if (!markup.includes("<!-- wp:row")) {
		return markup;
	}
	const normalized = markup
		.replace(/<!-- wp:row(\s+(\{[\s\S]*?\}))?\s*-->/g, (_match, _g1, attrs) => {
			let parsedAttrs = {};
			if (attrs) {
				try {
					parsedAttrs = JSON.parse(attrs);
				} catch {
					// Unparseable attributes; a bare flex group still beats an
					// unregistered block.
					parsedAttrs = {};
				}
			}
			if (!parsedAttrs.layout || parsedAttrs.layout.type !== "flex") {
				parsedAttrs.layout = { ...(parsedAttrs.layout || {}), type: "flex" };
			}
			return `<!-- wp:group ${JSON.stringify(parsedAttrs)} -->`;
		})
		.replace(/<!-- \/wp:row -->/g, "<!-- /wp:group -->")
		.replace(/\bwp-block-row\b/g, "wp-block-group");
	logger.log("[blockValidator] Rewrote wp:row as a flex core/group");
	return normalized;
}

/**
 * Move a cover block's background image into its attributes.
 *
 * core/cover keeps the background in `url` and regenerates the <img> from it,
 * so an image written only into the HTML is discarded.
 *
 * @param {string} markup Raw block markup from the model.
 * @return {string} Markup with cover background URLs present in attributes.
 */
function normalizeCoverBackgrounds(markup) {
	if (!markup.includes("<!-- wp:cover")) {
		return markup;
	}
	let changed = false;
	const normalized = markup.replace(
		/<!-- wp:cover(\s+\{[\s\S]*?\})?\s*-->([\s\S]*?)(?=<!-- wp:cover|<!-- \/wp:cover -->)/g,
		(match, attrs, body) => {
			let parsedAttrs = {};
			if (attrs) {
				try {
					parsedAttrs = JSON.parse(attrs.trim());
				} catch {
					return match;
				}
			}
			if (parsedAttrs.url || parsedAttrs.useFeaturedImage) {
				return match;
			}
			const img = body.match(
				/<img[^>]*class="[^"]*wp-block-cover__image-background[^"]*"[^>]*src="([^"]+)"/
			);
			const src = img?.[1];
			if (!src || src.includes("__IMG_")) {
				return match;
			}
			changed = true;
			return `<!-- wp:cover ${JSON.stringify({ ...parsedAttrs, url: src })} -->${body}`;
		}
	);
	if (changed) {
		logger.log("[blockValidator] Lifted cover background image into the url attribute");
	}
	return normalized;
}

export const validateBlockMarkup = (rawBlockContent) => {
	if (!rawBlockContent || typeof rawBlockContent !== "string") {
		return { valid: false, error: "block_content is empty or not a string" };
	}

	// Repair known model mistakes first; after parse() the content is gone.
	const blockContent = normalizeCoverBackgrounds(
		normalizeRowBlocks(normalizeListItems(rawBlockContent))
	);

	// Must contain block comments
	if (!blockContent.includes("<!-- wp:")) {
		return { valid: false, error: "Missing block comments (<!-- wp:... -->)" };
	}

	// Backstop for write paths with no image step of their own (blu-add-page and
	// friends). Handlers that can generate images check earlier and return a more
	// specific error; this only catches what they miss.
	const unresolvedImages = findImagePlaceholders(blockContent);
	if (unresolvedImages.length > 0) {
		return {
			valid: false,
			error: `Unresolved image placeholders: ${unresolvedImages.join(", ")}. Nothing was changed. This tool cannot generate images — use blu/add-section or blu/edit-block with one image_prompts entry per placeholder, or write a real image URL. Never write the placeholder into the page.`,
		};
	}

	// ── Pre-check: HTML tag balance ──
	// Catch malformed markup (e.g., missing closing </div>) before parse()
	// silently drops inner blocks.  This gives the AI a specific, fixable error.
	const balance = checkTagBalance(blockContent);
	if (!balance.balanced) {
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
				logger.log(`[blockValidator] Auto-wrapping ${parsed[i].name} in ${wrapper}`);
				const wrappedBlock = createBlock(wrapper, {}, [
					createBlock(
						parsed[i].name || parsed[i].blockName,
						parsed[i].attributes || parsed[i].attrs || {},
						parsed[i].innerBlocks || []
					),
				]);
				parsed.splice(i, 1, wrappedBlock);
			}
		}
	}

	// Self-closing navigation-link: preserve JSON attrs — createBlock()+serialize()
	// can drop them when the block type is not fully registered in this bundle.
	const navLinkBlock = validBlocks.find((b) => (b.name || b.blockName) === "core/navigation-link");
	if (
		validBlocks.length === 1 &&
		navLinkBlock &&
		!blockContent.includes("</") &&
		(navLinkBlock.attributes?.label ||
			navLinkBlock.attrs?.label ||
			// eslint-disable-next-line eqeqeq -- intentional loose check: matches null and undefined
			navLinkBlock.attributes?.id != null ||
			// eslint-disable-next-line eqeqeq -- intentional loose check: matches null and undefined
			navLinkBlock.attrs?.id != null ||
			navLinkBlock.attributes?.url ||
			navLinkBlock.attrs?.url)
	) {
		logger.log("[blockValidator] Preserving self-closing navigation-link markup");
		return { valid: true, blocks: validBlocks, correctedContent: blockContent.trim() };
	}

	// ── Always normalize ──
	// Recreate every block via createBlock() + serialize() so the HTML is
	// exactly what WordPress's save() function produces.  The AI only needs
	// to get the block comment JSON attributes right — the HTML is rebuilt.
	try {
		const recreate = (block) => {
			const innerBlocks = (block.innerBlocks || []).map(recreate);
			const name = block.name || block.blockName;
			const attributes = block.attributes || block.attrs || {};
			return createBlock(name, attributes, innerBlocks);
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
		const preNormCount = deepBlockCount(parsed);
		const postNormCount = deepBlockCount(reParsed);
		if (preNormCount > 0 && postNormCount < preNormCount) {
			const lost = preNormCount - postNormCount;

			console.warn(
				`[blockValidator] Normalization lost ${lost} of ${preNormCount} blocks (${postNormCount} remain)`
			);
			return {
				valid: false,
				error: `Normalization dropped ${lost} of ${preNormCount} inner blocks — the markup is too complex or malformed for a single tool call. Break it into smaller steps: (1) use blu-add-section to add a container, then (2) use additional blu-add-section calls with after_client_id or as_child_of to add inner content piece by piece.`,
			};
		}

		logger.log("[blockValidator] Normalized markup");
		return { valid: true, blocks: reParsed, correctedContent: normalizedContent };
	} catch (e) {
		return { valid: false, error: `Block normalization failed: ${e.message}` };
	}
};
