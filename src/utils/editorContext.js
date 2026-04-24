/* eslint-disable no-undef, no-console */
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
import { NFD_CLASS_REFERENCE } from "./nfdClassReference";
/**
 * Nudge injected with the user's message on the tool-calling pass. Asks the
 * model to emit a one-sentence natural-language plan as assistant text BEFORE
 * its tool_calls, then proceed directly to tools in the same response.
 *
 * If the request is purely conversational (greeting, question, chat), the
 * model responds normally without tool_calls and the loop exits.
 *
 * Editing tasks with reasonable defaults (add a column, change a color,
 * duplicate a block, etc.) MUST be executed using the existing design as
 * reference — do NOT ask for clarification on trivia the model can infer.
 */
export const EXECUTE_NUDGE = `Start your response with ONE short sentence (under 20 words) addressed to the user that states what you're about to do (e.g. "I'll add another column matching the existing design."). Then immediately call the tool(s) needed. Do not mention tool names, client IDs, or technical details in the sentence. For editing tasks where reasonable defaults exist (matching existing design, plausible placeholder content, standard icon choices), EXECUTE directly — do not ask clarifying questions unless the request is genuinely ambiguous. If the message is purely conversational, just reply normally with no tool calls.`;

/**
 * Nudge injected after tools have been executed successfully.
 * Asks the model for a brief confirmation instead of more tool calls.
 */
export const SUMMARIZE_NUDGE = `All requested changes are applied. Respond with ONE brief sentence confirming what was done. Do not repeat the plan or call any tools.`;

/**
 * Build editor context string with block tree and selected block markup.
 * This is prepended to user messages so the AI has current page state.
 *
 * @return {string} Editor context string wrapped in <editor_context> tags
 */
export const buildEditorContext = () => {
	const { select: wpSelect } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const blocks = getCurrentPageBlocks();
	const selectedBlocks = getSelectedBlocks();
	const selectedClientIds = selectedBlocks.map((b) => b.clientId);

	const pageTitle = getCurrentPageTitle();
	const pageId = getCurrentPageId();

	const site = window.nfdEditorChat?.site || {};
	const siteUrl = window.location.origin;

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
	context += `\nPage: "${pageTitle}" (ID: ${pageId})\n\n`;
	context += "Block tree:\n";
	context += buildCompactBlockTree(blocks, selectedClientIds, {
		collapseUnselected: selectedBlocks.length > 0,
	});

	// Layer 2a: Ancestor chain for each selected block. Surfaces the clientIds
	// of parent blocks so the AI can edit a container (e.g. core/columns) when
	// the user's selection is nested inside it, without an extra get-block-markup
	// round-trip to discover the parent id.
	if (selectedBlocks.length > 0) {
		for (const sel of selectedBlocks) {
			// getBlockParents returns clientIds from root → nearest parent.
			const parentIds = blockEditor.getBlockParents(sel.clientId) || [];
			if (parentIds.length === 0) continue;
			context += `\n\nAncestors of ${sel.name} (id:${sel.clientId}) — nearest first:`;
			for (let i = parentIds.length - 1; i >= 0; i--) {
				const parent = blockEditor.getBlock(parentIds[i]);
				if (parent) {
					context += `\n  ${parent.name} (id:${parent.clientId})`;
				}
			}
			context += `\n  <root>`;
		}
	}

	// Layer 2: Selected block markup (one section per selected block)
	if (selectedBlocks.length > 0) {
		const { serialize: wpSerialize } = wp.blocks;
		const label = selectedBlocks.length === 1 ? "Selected block markup" : "Selected blocks markup";
		context += `\n\n${label}:`;
		for (const sel of selectedBlocks) {
			const fullBlock = blockEditor.getBlock(sel.clientId);
			if (fullBlock) {
				// Template parts serialize to a self-closing comment; show inner blocks instead.
				let markup;
				if (fullBlock.name === "core/template-part") {
					const innerBlocks = blockEditor.getBlocks(sel.clientId);
					markup = innerBlocks.map((b) => wpSerialize(b)).join("\n");
				} else {
					markup = wpSerialize(fullBlock);
				}
				context += `\n\n--- ${fullBlock.name} (id:${fullBlock.clientId}) ---\n${markup}`;
			}
		}
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
	} catch (e) {
		// Non-critical — continue without palette data
	}

	// Inject nfd-* class reference when blocks use nfd-* utilities
	if (context.includes("nfd-")) {
		context += `\n\nNFD utility class reference (these classes are from the site's design system — preserve them, do not remove or replace unless the user specifically asks to change the property they control):\n${NFD_CLASS_REFERENCE}`;
	}

	return context;
};

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
