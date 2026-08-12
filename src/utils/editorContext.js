/**
 * Editor context utilities.
 *
 * System prompt, tool descriptions, and functions that read the current
 * WordPress editor state to build context for the AI.
 */
import {
	buildCompactBlockTree,
	getCurrentPageBlocks,
	getCurrentPageTitle,
	getCurrentPageId,
	getSelectedBlocks,
} from "./editorHelpers";
import { getCurrentGlobalStyles } from "../services/globalStylesService";
import {
	buildNavigationMenuContextLines,
	findRefNavigationBlocks,
} from "../services/navigationEditor";
import { IMAGE_BLOCKS, LOGO_BLOCK } from "../services/blockToolbar/blockAI";
import { getBlockImageUrl } from "../services/imageAbility";
import { NFD_CLASS_REFERENCE } from "./nfdClassReference";

/** Max blocks whose full markup is injected via extraClientIds. */
export const MAX_CONTEXT_TARGET_BLOCKS = 2;

const MAX_MARKUP_CHARS = 8000;
const LARGE_BLOCK_INNER_THRESHOLD = 40;

/**
 * Count all inner blocks recursively.
 *
 * @param {Object} block Block object from the editor store.
 * @return {number} Total inner block count.
 */
function countInnerBlocks(block) {
	if (!block?.innerBlocks?.length) {
		return 0;
	}
	return block.innerBlocks.reduce((sum, ib) => sum + 1 + countInnerBlocks(ib), 0);
}

/**
 * Serialize one block's markup for AI context.
 *
 * @param {Object} blockEditor core/block-editor selector
 * @param {string} clientId    Block clientId
 * @return {{ markup: string, blockName: string, block: Object }|null} Serialized markup or null.
 */
function serializeBlockMarkup(blockEditor, clientId) {
	const fullBlock = blockEditor.getBlock(clientId);
	if (!fullBlock) {
		return null;
	}
	const { serialize: wpSerialize } = wp.blocks;
	let markup;
	if (fullBlock.name === "core/template-part" || fullBlock.name === "core/navigation") {
		const innerBlocks = blockEditor.getBlocks(clientId);
		markup = innerBlocks.map((b) => wpSerialize(b)).join("\n");
		if (!markup && fullBlock.name === "core/navigation" && fullBlock.attributes?.ref) {
			const entity = wp.data.select("core").getEntityRecord(
				"postType",
				"wp_navigation",
				fullBlock.attributes.ref
			);
			const raw =
				entity?.content?.raw || entity?.content?.rendered || entity?.content || "";
			markup = typeof raw === "string" ? raw : "";
		}
	} else {
		markup = wpSerialize(fullBlock);
	}
	return { markup, blockName: fullBlock.name, block: fullBlock };
}

/**
 * Append ancestor chain for a target block.
 *
 * @param {string} context     Context built so far
 * @param {Object} blockEditor core/block-editor selector
 * @param {Object} block       Target block
 * @return {string} Context with ancestor chain appended.
 */
function appendAncestorChain(context, blockEditor, block) {
	const parentIds = blockEditor.getBlockParents(block.clientId) || [];
	if (parentIds.length === 0) {
		return context;
	}
	let next = context;
	next += `\n\nAncestors of ${block.name} (id:${block.clientId}) — nearest first:`;
	for (let i = parentIds.length - 1; i >= 0; i--) {
		const parent = blockEditor.getBlock(parentIds[i]);
		if (parent) {
			next += `\n  ${parent.name} (id:${parent.clientId})`;
		}
	}
	next += `\n  <root>`;
	return next;
}

/**
 * Append serialized markup sections for the given clientIds.
 *
 * @param {string}   context     Context built so far
 * @param {Object}   blockEditor core/block-editor selector
 * @param {string[]} clientIds   Blocks to serialize
 * @param {string}   label       Section heading
 * @return {string} Context with markup sections appended.
 */
function appendMarkupSections(context, blockEditor, clientIds, label) {
	if (!clientIds.length) {
		return context;
	}
	let next = context + `\n\n${label}:`;
	for (const clientId of clientIds) {
		const serialized = serializeBlockMarkup(blockEditor, clientId);
		if (!serialized) {
			continue;
		}
		const { markup, blockName, block } = serialized;
		const innerCount = countInnerBlocks(block);
		if (innerCount >= LARGE_BLOCK_INNER_THRESHOLD) {
			next += `\n\n--- ${blockName} (id:${clientId}) [LARGE: ${innerCount} inner blocks — use blu-update-block-attrs on children or blu-get-block-markup for a subtree] ---`;
			continue;
		}
		let sectionMarkup = markup;
		if (sectionMarkup.length > MAX_MARKUP_CHARS) {
			sectionMarkup =
				sectionMarkup.slice(0, MAX_MARKUP_CHARS) +
				"\n...[markup truncated for context size — call blu-get-block-markup for the full block]";
		}
		next += `\n\n--- ${blockName} (id:${clientId}) ---\n${sectionMarkup}`;
	}
	return next;
}

/**
 * Nudge injected with the user's message on the tool-calling pass.
 *
 * The model must reply with a JSON object (see ASSISTANT_JSON_FORMAT) as its
 * entire text output, then call tools in the same response when appropriate.
 */
export const ASSISTANT_JSON_FORMAT = `Your entire text output MUST be a single JSON object — no markdown fences, no text before or after:
{"message":"Short sentence for the user (under 20 words)"}

When you will call editing tools in the same response, put your plan ONLY in "message", then call the tool(s). Do not mention tool names, client IDs, UUIDs, ref IDs, or block type slugs (core/…) in message — write for a non-technical site owner.

If no block is selected and you need serialized block markup before editing, reply with JSON only (no tool calls):
{"message":"Brief note","need_blocks_markup":["exact-clientId-from-block-tree"]}
Use 1–2 exact clientIds from the block tree. If markup is already under "Selected block markup" or "Target block markup", or blu-update-block-attrs is enough, use the first format and call tools instead.

If the request is purely conversational, reply with JSON only and no tool calls:
{"message":"Your reply"}

Output rules:
- Return ONLY valid JSON.
- No explanations, no comments, no extra text.
`;

export const EXECUTE_NUDGE = `${ASSISTANT_JSON_FORMAT}

For editing tasks where reasonable defaults exist (matching existing design, plausible placeholder content, standard icon choices), EXECUTE directly — do not ask clarifying questions unless the request is genuinely ambiguous.

Complete every change listed in <user_intent> steps — call all the tools needed in this same response. Do not stop after the first one.`;

/**
 * Nudge injected after tools have been executed successfully.
 * Asks the model for a brief confirmation instead of more tool calls.
 */
export const SUMMARIZE_NUDGE = `All requested changes are applied. Respond with JSON only — no tool calls:
{"message":"One brief sentence confirming what was done."}`;

/**
 * Nudge injected after blu-generate-color-palette returns option(s) the user
 * must choose between before anything is applied. The default "one brief
 * sentence" / "under 20 words" instruction (ASSISTANT_JSON_FORMAT,
 * SUMMARIZE_NUDGE) is right for confirmations but wrong here — it leads the
 * model to say "here are N options" without ever listing them, leaving the
 * user nothing to actually choose from.
 */
export const PRESENT_PALETTE_OPTIONS_NUDGE = `Your entire text output MUST be a single JSON object — no markdown fences, no text before or after:
{"message":"..."}

The tool result above contains the generated color palette option(s), each with its own hex codes. In "message", list every option in full using markdown (a heading or bold label per palette, then a bullet per color with its exact hex code as returned — do not paraphrase, invent, or omit any value). End by asking which one to apply. Do not call any tools in this response.

Output rules:
- Return ONLY valid JSON.
- No explanations, no comments, no extra text.
`;

/**
 * Nudge for a turn with steps still unapplied. Replaces {@link SUMMARIZE_NUDGE},
 * whose "All requested changes are applied" is false mid-plan — the model would
 * otherwise confirm a job it only half did.
 *
 * @param {string[]} remaining Steps not yet applied.
 * @return {string} Nudge string for the next pass.
 */
export function buildRemainingStepsNudge(remaining) {
	return `Not every requested change has been applied yet. Still to do:
${remaining.map((step) => `- ${step}`).join("\n")}

Call the tool(s) for the next unfinished item now. If one genuinely cannot be done, say which and why — never report work that no tool call performed.

When everything is done, reply with JSON only and no tool calls:
{"message":"One brief sentence covering what was done."}`;
}

/**
 * Build a summarize nudge after successful content creation.
 *
 * @param {Object} outcome Creation outcome from handleContentCreation.
 * @return {string} Nudge string for the summarize pass.
 */
export function buildCreationSummarizeNudge(outcome) {
	const { navigated, editUrl, postType, title, id } = outcome;
	let hint = "";
	if ((postType === "page" || postType === "post") && navigated) {
		hint =
			postType === "page"
				? " The editor preview has opened the new page."
				: " The block editor has opened the new post.";
	} else if (editUrl) {
		const label = title || "new draft";
		hint = ` Include a markdown link: [${label}](${editUrl})`;
	}
	return `Content creation succeeded (ID: ${id}, type: ${postType}). Respond with JSON only — no tool calls:
{"message":"Brief confirmation.${hint}"}`;
}

/**
 * Enrich a toolbar message when the user is editing a selected image block.
 *
 * @param {string} instruction User instruction from the block toolbar.
 * @param {string} [clientId]  Selected block clientId from the toolbar event.
 * @return {string} The formatted user message for the image edit request.
 */
export function formatImageEditUserMessage(instruction, clientId) {
	if (!clientId) {
		return instruction;
	}

	const block = wp.data.select("core/block-editor").getBlock(clientId);
	if (!block) {
		return instruction;
	}

	if (block.name === LOGO_BLOCK) {
		return (
			`[Logo replacement request] Selected block: core/site-logo (id:${clientId}). ` +
			`User instruction: ${instruction}`
		);
	}

	if (!IMAGE_BLOCKS.has(block.name)) {
		return instruction;
	}

	const sourceUrl = getBlockImageUrl(block);
	if (!sourceUrl) {
		return instruction;
	}

	return (
		`[Image edit request] Selected block: ${block.name} (id:${clientId}). ` +
		`Current image URL: ${sourceUrl}. ` +
		`User instruction: ${instruction}`
	);
}

/**
 * Build editor context string with block tree and selected block markup.
 * This is prepended to user messages so the AI has current page state.
 *
 * @param {Object}   [options]
 * @param {string[]} [options.extraClientIds] Target blocks (AI-requested) whose markup is included
 * @return {string} Editor context string
 */
export const buildEditorContext = ({ extraClientIds = [] } = {}) => {
	const { select: wpSelect } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const blocks = getCurrentPageBlocks();
	const selectedBlocks = getSelectedBlocks();
	const selectedClientIds = selectedBlocks.map((b) => b.clientId);
	const selectedSet = new Set(selectedClientIds);
	const refNavBlocks = findRefNavigationBlocks(blocks);
	const autoNavMarkupIds = refNavBlocks
		.map((b) => b.clientId)
		.filter((id) => id && !selectedSet.has(id));
	const extraTargets = [...autoNavMarkupIds, ...(extraClientIds || [])]
		.filter((id) => id && !selectedSet.has(id))
		.filter((id, index, arr) => arr.indexOf(id) === index)
		.slice(0, MAX_CONTEXT_TARGET_BLOCKS);

	const pageTitle = getCurrentPageTitle();
	const pageId = getCurrentPageId();
	const postType = wpSelect("core/editor").getCurrentPostType();
	const contentLabel = postType === "post" ? "Post" : "Page";

	const site = window.nfdEditorChat?.site || {};
	// homeUrl comes from get_home_url() and keeps the subdirectory of installs
	// served under a path (e.g. https://example.com/website_123). Deriving it from
	// window.location.origin drops that path and produces 404 links.
	const siteUrl = (window.nfdEditorChat?.homeUrl || window.location.origin).replace(/\/+$/, "");

	let context = `Site: ${site.title || ""}`;
	if (site.description) {
		context += ` — ${site.description}`;
	}
	context += `\nURL: ${siteUrl}`;
	if (site.siteType) {
		context += `\nType: ${site.siteType}`;
	}
	if (site.locale) {
		context += `\nLocale: ${site.locale}`;
	}
	context += `\n${contentLabel}: "${pageTitle}" (ID: ${pageId})\n\n`;
	context += "Block tree:\n";
	context += buildCompactBlockTree(blocks, selectedClientIds, {
		collapseUnselected: selectedBlocks.length > 0,
	});

	if (refNavBlocks.length > 0) {
		context += "\n\nHeader/footer navigation menus (edit navigation-link children below):";
		for (const nav of refNavBlocks) {
			context += `\nMenu block (id:${nav.clientId}):`;
			const menuLines = buildNavigationMenuContextLines(nav, blockEditor);
			context += menuLines.length ? `\n${menuLines.join("\n")}` : "\n  (no items loaded yet)";
		}
	}

	// Layer 2a: Ancestor chains for selected and AI-requested target blocks.
	const ancestorBlocks = [...selectedBlocks];
	for (const clientId of extraTargets) {
		const block = blockEditor.getBlock(clientId);
		if (block) {
			ancestorBlocks.push(block);
		}
	}
	for (const block of ancestorBlocks) {
		context = appendAncestorChain(context, blockEditor, block);
	}

	// Layer 2b: Selected block markup
	if (selectedBlocks.length > 0) {
		const label = selectedBlocks.length === 1 ? "Selected block markup" : "Selected blocks markup";
		context = appendMarkupSections(
			context,
			blockEditor,
			selectedBlocks.map((b) => b.clientId),
			label
		);
	}

	// Layer 2c: Target block markup (requested via need_block_markup JSON)
	if (extraTargets.length > 0) {
		const label = extraTargets.length === 1 ? "Target block markup" : "Target blocks markup";
		context = appendMarkupSections(context, blockEditor, extraTargets, label);
	}

	// Inject active color palette so the AI knows actual hex values
	try {
		const { palette } = getCurrentGlobalStyles();
		if (palette && palette.length > 0) {
			context += "\n\nActive color palette:";
			for (const color of palette) {
				context += `\n  ${color.slug}: ${color.color} ("${color.name}")`;
			}
		}
	} catch {
		// Non-critical — continue without palette data
	}

	// Inject nfd-* class reference when blocks use nfd-* utilities
	if (context.includes("nfd-")) {
		context += `\n\nNFD utility class reference (these classes are from the site's design system — preserve them, do not remove or replace unless the user specifically asks to change the property they control):\n${NFD_CLASS_REFERENCE}`;
	}

	// Site logo is a raster/SVG image — CSS color attrs on core/site-logo (or its
	// header/template-part ancestors) do not edit it. Always steer logo tweak
	// requests to blu/edit-logo, even when only the header is selected.
	if (blockTreeContainsName(blocks, LOGO_BLOCK) || context.includes("core/site-logo")) {
		context +=
			"\n\nSite logo guidance (CRITICAL):" +
			"\n- core/site-logo is an IMAGE. NEVER use blu/update-block-attrs (textColor, backgroundColor, style.color, etc.) to change its appearance — CSS cannot edit the logo image." +
			"\n- To modify the existing logo (colors, text, layout, elements): call blu/edit-logo(prompt=<what to change>). Works even when only the header/template-part is selected — you do NOT need to select the logo block." +
			"\n- To create a brand-new logo design from scratch: call blu/regenerate-logo." +
			"\n- To use an uploaded image as the logo: blu/edit-image then blu/set-logo-from-image.";
	}

	context +=
		"\n\nInternal link guidance (CRITICAL):" +
		`\n- The site URL above (${siteUrl}) is the ONLY valid base for internal links. This site may be installed in a subdirectory, so NEVER build links from the bare domain.` +
		`\n- Every internal href MUST start with "${siteUrl}/" (e.g. "${siteUrl}/contact"). A link like "/contact" or "https://<domain>/contact" that skips the base path returns a 404.` +
		"\n- Only link to pages that actually exist. Prefer a page listed in the block tree, the navigation menus above, or one you just created with a create tool (use the URL it returned)." +
		"\n- If the user asks to link to a page that does not exist yet, either link to an existing relevant page or say so in your message — do not invent a slug.";

	return context;
};

/**
 * Recursively check whether a block tree contains a block with the given name.
 *
 * @param {Array}  blocks Top-level blocks.
 * @param {string} name   Block name to find.
 * @return {boolean} True if found.
 */
function blockTreeContainsName(blocks, name) {
	if (!Array.isArray(blocks)) {
		return false;
	}
	for (const block of blocks) {
		if (block?.name === name) {
			return true;
		}
		if (blockTreeContainsName(block?.innerBlocks, name)) {
			return true;
		}
	}
	return false;
}

/**
 * Deep clone blocks for snapshot undo.
 * Uses the block editor's getBlocks() and serializes/re-parses for a clean deep copy.
 *
 * @param {Array} blocks Array of block objects from getBlocks()
 * @return {Array} Deep-cloned block array
 */
export const snapshotBlocks = (blocks) => {
	try {
		const { serialize: wpSerialize } = wp.blocks;
		const { parse: wpParse } = wp.blocks;
		const serialized = blocks.map((b) => wpSerialize(b)).join("");
		return wpParse(serialized);
	} catch (e) {
		console.error("Failed to snapshot blocks:", e);
		return [];
	}
};
