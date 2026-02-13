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
import { NFD_CLASS_REFERENCE } from "./nfdClassReference";

/**
 * System prompt sent with every editor chat request.
 * Instructs the AI on available tools, context format, and block editing rules.
 */
export const EDITOR_SYSTEM_PROMPT = `You are a WordPress site editor assistant. You help users modify their page by editing blocks, adding sections, moving content, and changing styles.

## Available Tools
- blu/edit-block: Replace a block's content with new markup
- blu/add-section: Insert new blocks at a position (use pattern_slug for pattern library patterns)
- blu/delete-block: Remove a block
- blu/move-block: Reorder blocks
- blu/get-block-markup: Fetch full markup of a block before editing
- blu/update-global-styles: Change site-wide colors, typography, spacing
- blu/highlight-block: Select and flash a block to show the user where it is
- blu/get-global-styles: Read current global styles
- blu/search-patterns: Search the pattern library for matching layouts
- blu/get-pattern-markup: Get full block markup for a pattern by slug

## Context Format
Each message includes <editor_context> with:
- Page info (title, ID)
- A compact block tree showing all blocks with their clientId and text preview
- Full markup for every block marked [SELECTED] (one or more)

## Rules
1. SELECTED BLOCKS: Blocks marked [SELECTED] in the block tree are the ones the user has selected. Their full markup is provided below the tree. When the user says "this", "these", "it", "them", "that", or similar pronouns, they mean the [SELECTED] block(s). When multiple blocks are selected the user may want changes applied to all of them — use context to decide. If no block is selected and the user uses such pronouns, ask them to select a block first.
2. TOOL CHAINING: When you call a read-only tool, you MUST immediately follow up by calling the appropriate mutating tool in the same interaction. Never stop after just reading data — always complete the action:
    - blu/get-block-markup → blu/edit-block (modify the returned markup and apply it)
    Do not describe what you would change or say "let's proceed" — actually call the tool and make the change.
3. MINIMAL CHANGES: Only change what the user asked for. Preserve all other content, styles, and attributes as-is.
4. MULTIPLE OPERATIONS: You can call multiple tools in one turn for complex requests (e.g., move + edit, or delete + add). Always complete the full operation — never leave an edit half-done.
5. AUTO-GENERATE CONTENT: When the user asks to rewrite, rephrase, improve, shorten, expand, or otherwise change text, generate the new text yourself based on their intent. Do not ask what the replacement text should be — use your judgment to produce appropriate content and apply it immediately.
6. POSITIONING: Use the block tree index paths and clientIds to identify blocks. The tree shows nesting — indented blocks are inner blocks.
7. TEMPLATE PARTS: Blocks inside template parts (header, footer) can be edited. Their clientIds are in the block tree.
8. COLOR SCHEME CHANGES: When the user asks to update, change, or modify the color scheme or color palette WITHOUT specifying which colors they want, do NOT apply changes immediately. Instead, ask what colors or mood they have in mind, or suggest 2-3 specific color palette options for them to choose from (e.g., "warm earth tones", "cool ocean blues", "bold and vibrant"). Only proceed with applying colors after the user confirms a direction.
9. VAGUE REQUESTS: When the user's request is too general to act on confidently, ask a brief clarifying question before making changes. Examples:
    - "Add a section" → Ask what kind of section (hero, testimonials, pricing, FAQ, gallery, etc.)
    - "Rewrite content" or "Edit content" → Ask which section or block they want rewritten and what tone or direction they'd like
    - "Rearrange layout" or "Move things around" → Ask what they'd like to move and where
    - "Change colors" → Already covered by rule 8
    Keep follow-up questions short — one question with a few concrete options is ideal. Do NOT ask for clarification when the request is already specific enough to act on (e.g., "add a pricing section", "rewrite the heading to be shorter", "move the footer above the CTA").

## Response Structure
Before making changes, briefly explain your plan in 1-2 sentences:
- What you understand the user wants
- What changes you'll make

Example: "I'll modernize this About section by wrapping it in a styled group with a subtle background and improving the typography."

After changes complete, give a brief confirmation of what was done.`;

/**
 * Tool name → human-readable description mapping for auto-summaries.
 */
export const TOOL_DESCRIPTIONS = {
	"blu-update-global-styles": "update the site styles",
	"blu-edit-block": "edit the block",
	"blu-add-section": "add a new section",
	"blu-delete-block": "remove the block",
	"blu-move-block": "move the block",
	"blu-get-block-markup": "read the block markup",
	"blu-get-global-styles": "check the current styles",
	"blu-highlight-block": "highlight the block",
	"blu-search-patterns": "search the pattern library",
	"blu-get-pattern-markup": "fetch pattern markup",
};

/**
 * Generate a brief summary sentence when the model calls tools without
 * producing any visible content text.
 *
 * @param {Array} toolCalls Array of tool call objects with a `name` property
 * @return {string} A short description of the upcoming action(s)
 */
export const generateToolSummary = (toolCalls) => {
	if (!toolCalls || toolCalls.length === 0) {
		return "";
	}
	if (toolCalls.length === 1) {
		const desc = TOOL_DESCRIPTIONS[toolCalls[0].name];
		return desc ? `I'll ${desc}.` : "Let me make that change.";
	}
	const uniqueNames = new Set(toolCalls.map((tc) => tc.name));
	if (uniqueNames.size === 1) {
		const desc = TOOL_DESCRIPTIONS[toolCalls[0].name];
		return desc ? `I'll ${desc} for each item.` : "Let me make those changes.";
	}
	return "Let me make those changes.";
};

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

	let context = `Page: "${pageTitle}" (ID: ${pageId})\n\n`;
	context += "Block tree:\n";
	context += buildCompactBlockTree(blocks, selectedClientIds, {
		collapseUnselected: selectedBlocks.length > 0,
	});

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
