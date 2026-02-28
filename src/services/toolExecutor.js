/* eslint-disable no-undef, no-console */
/**
 * Tool executor — handles MCP/client-side tool calls from the AI.
 *
 * Extracted from useEditorChat.js so the hook stays a slim orchestrator.
 * Receives a `ctx` object with all the clients, state setters, refs, and
 * helpers it needs — no direct React dependency.
 */
import { CHAT_STATUS } from "@newfold-labs/wp-module-ai-chat";
import { createBlock, serialize } from "@wordpress/blocks";
import { __ } from "@wordpress/i18n";

import {
	handleRewriteAction,
	handleDeleteAction,
	handleAddAction,
	handleMoveAction,
} from "./actionExecutor";
import { getCurrentGlobalStyles, updateGlobalStyles } from "./globalStylesService";
import patternLibrary from "./patternLibrary";
import { getBlockMarkup } from "../utils/editorHelpers";
import { validateBlockMarkup } from "../utils/blockValidator";
import { snapshotBlocks } from "../utils/editorContext";

/** Block-mutating tool names that require a snapshot for undo. */
const BLOCK_TOOL_NAMES = [
	"blu-edit-block",
	"blu-add-section",
	"blu-delete-block",
	"blu-move-block",
];

// ────────────────────────────────────────────────────────────────────
// Individual tool handlers
// ────────────────────────────────────────────────────────────────────

async function handleUpdateGlobalStyles(toolCall, args, ctx) {
	await ctx.updateProgress(__("Reading current styles…", "wp-module-editor-chat"), 500);

	try {
		await ctx.updateProgress(
			__("Applying style changes to your site…", "wp-module-editor-chat"),
			600
		);
		const jsResult = await updateGlobalStyles(args.settings, args.styles);

		if (jsResult.success) {
			await ctx.updateProgress(
				__("✓ Styles updated! Review and Accept or Decline.", "wp-module-editor-chat"),
				800
			);
			ctx.setHasGlobalStylesChanges(true);

			if (jsResult.undoData && !ctx.originalGlobalStylesRef.current) {
				ctx.originalGlobalStylesRef.current = jsResult.undoData;
			}
			const globalStylesUndoData = ctx.originalGlobalStylesRef.current || null;

			const { undoData: _unused, ...resultForAI } = jsResult;
			return {
				toolResult: {
					id: toolCall.id,
					result: [{ type: "text", text: JSON.stringify(resultForAI) }],
					isError: false,
					hasChanges: true,
				},
				globalStylesUndoData,
			};
		}
		await ctx.updateProgress(__("Retrying with alternative method…", "wp-module-editor-chat"), 400);
	} catch (jsError) {
		console.error("JS update threw error:", jsError);
		await ctx.updateProgress(__("Retrying with alternative method…", "wp-module-editor-chat"), 400);
	}

	// Fallback to MCP
	const result = await ctx.mcpClient.callTool(toolCall.name, toolCall.arguments);
	return {
		toolResult: {
			id: toolCall.id,
			result: result.content,
			isError: result.isError,
		},
		globalStylesUndoData: null,
	};
}

async function handleGetGlobalStyles(toolCall, ctx) {
	await ctx.updateProgress(__("Reading site color palette…", "wp-module-editor-chat"), 500);

	try {
		await ctx.updateProgress(__("Analyzing theme settings…", "wp-module-editor-chat"), 600);
		const jsResult = getCurrentGlobalStyles();

		if (jsResult.palette?.length > 0 || jsResult.rawSettings) {
			const colorCount = jsResult.palette?.length || 0;
			await ctx.updateProgress(`✓ Found ${colorCount} colors in palette`, 700);
			return {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({
							styles: jsResult,
							message: "Retrieved global styles from editor",
						}),
					},
				],
				isError: false,
			};
		}
		await ctx.updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
	} catch (jsError) {
		console.error("JS get styles threw error:", jsError);
		await ctx.updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
	}

	// Fall through — caller will hit the default MCP path
	return null;
}

// ────────────────────────────────────────────────────────────────────
// Safe block-edit helpers
//
// The AI frequently rewrites entire block trees when only wrapper
// attributes (background-color, text-color, spacing) changed.  This
// causes WordPress block-validation failures and strips inner blocks.
//
// When the AI's replacement has the SAME inner-block structure (names
// and nesting) as the original, we take a safe path: extract the AI's
// attributes at every level and merge them into the ORIGINAL block
// tree.  Inner blocks are never at risk.
// ────────────────────────────────────────────────────────────────────

/**
 * Count all inner blocks recursively.
 *
 * @param {Object} block A parsed or editor block object.
 * @return {number} Total number of inner blocks (all levels).
 */
function countInnerBlocks(block) {
	if (!block.innerBlocks || block.innerBlocks.length === 0) {
		return 0;
	}
	return block.innerBlocks.reduce((sum, ib) => sum + 1 + countInnerBlocks(ib), 0);
}

/**
 * Recursively check if two block trees have the same structure
 * (same block names at every level, same nesting depth).
 *
 * @param {Object} original The live block from the editor.
 * @param {Object} parsed   The parsed block from the AI's markup.
 * @return {boolean} True if inner-block structure matches.
 */
function innerBlockStructureMatches(original, parsed) {
	const origInner = original.innerBlocks || [];
	const newInner = parsed.innerBlocks || [];
	if (origInner.length !== newInner.length) {
		return false;
	}
	return origInner.every(
		(orig, i) => orig.name === newInner[i].name && innerBlockStructureMatches(orig, newInner[i])
	);
}

/**
 * Deep-clone a live block tree using createBlock.
 *
 * @param {Object} block A block from the editor store.
 * @return {Object} A fresh block object (new clientId).
 */
function cloneBlockTree(block) {
	const innerBlocks = (block.innerBlocks || []).map(cloneBlockTree);
	return createBlock(block.name, { ...(block.attributes || {}) }, innerBlocks);
}

/**
 * Deep-merge two style objects. AI's values overlay originals.
 *
 * @param {Object} original The original style object.
 * @param {Object} aiStyle  The AI's style object.
 * @return {Object} Merged style.
 */
function deepMergeStyle(original, aiStyle) {
	if (!original) {
		return aiStyle;
	}
	if (!aiStyle) {
		return original;
	}
	const merged = { ...original };
	for (const key of Object.keys(aiStyle)) {
		if (
			typeof aiStyle[key] === "object" &&
			aiStyle[key] !== null &&
			typeof merged[key] === "object" &&
			merged[key] !== null
		) {
			merged[key] = deepMergeStyle(merged[key], aiStyle[key]);
		} else {
			merged[key] = aiStyle[key];
		}
	}
	return merged;
}

/**
 * Merge className strings conservatively.
 *
 * Preserves nfd-* utility classes (except nfd-theme-*) and responsive
 * variants (md:nfd-*) from the original, even if the AI dropped them.
 * Allows intentional removal of is-style-nfd-theme-* and nfd-theme-*
 * (color scheme changes). Adds any new classes from the AI.
 *
 * @param {string} originalClassName The original className.
 * @param {string} aiClassName       The AI's className.
 * @return {string} Merged className.
 */
function mergeClassNames(originalClassName, aiClassName) {
	const origClasses = (originalClassName || "").split(/\s+/).filter(Boolean);
	const aiClasses = new Set((aiClassName || "").split(/\s+/).filter(Boolean));

	// Preserve original classes the AI likely dropped accidentally
	const preserved = origClasses.filter((cls) => {
		if (aiClasses.has(cls)) {
			return true;
		}
		// Preserve nfd-* utility classes (except theme classes — those are intentionally removable)
		if (cls.startsWith("nfd-") && !cls.startsWith("nfd-theme-")) {
			return true;
		}
		// Preserve responsive nfd variants
		if (cls.startsWith("md:nfd-")) {
			return true;
		}
		// Preserve is-style- classes EXCEPT is-style-nfd-theme- (intentional color change)
		if (cls.startsWith("is-style-") && !cls.startsWith("is-style-nfd-theme-")) {
			return true;
		}
		// AI dropped it and it's not in the preserve list — let it go
		return false;
	});

	// Add new classes from the AI that aren't already in the list
	for (const cls of aiClasses) {
		if (!preserved.includes(cls)) {
			preserved.push(cls);
		}
	}

	return preserved.join(" ");
}

/**
 * Conservatively merge block attributes: start with the original,
 * overlay only what the AI explicitly changed.
 *
 * - Attributes the AI didn't include are kept from the original
 *   (e.g., align, layout, metadata).
 * - className is merged at the class level (preserves nfd-* classes).
 * - style is deep-merged (preserves spacing/typography if AI only changed color).
 * - Other AI-provided attributes override the original.
 *
 * @param {Object} originalAttrs The original block attributes.
 * @param {Object} aiAttrs       The AI's parsed block attributes.
 * @return {Object} Merged attributes.
 */
function mergeBlockAttributes(originalAttrs, aiAttrs) {
	const merged = { ...originalAttrs };

	for (const key of Object.keys(aiAttrs || {})) {
		if (key === "className") {
			merged.className = mergeClassNames(originalAttrs.className, aiAttrs.className);
		} else if (key === "style") {
			merged.style = deepMergeStyle(originalAttrs.style, aiAttrs.style);
		} else if (key === "layout") {
			// Layout is structural — in the safe merge path (same inner-block
			// structure), keep the original layout. Layout type changes
			// (constrained → flex) come with structural changes that would
			// take the full-replacement path instead.
		} else {
			merged[key] = aiAttrs[key];
		}
	}

	return merged;
}

/**
 * Build a safe block tree: conservatively merge AI's attribute changes
 * onto the original block structure (names, nesting, inner-block order).
 *
 * This guarantees inner blocks are preserved AND original attributes
 * (layouts, nfd classes, metadata) are kept — only explicitly changed
 * attributes from the AI are applied.
 *
 * @param {Object} originalBlock The live block from the editor.
 * @param {Object} newParsed     The parsed block from the AI's markup.
 * @return {Object} A new block tree safe to serialize and apply.
 */
function buildSafeBlockTree(originalBlock, newParsed) {
	const origInner = originalBlock.innerBlocks || [];
	const newInner = newParsed.innerBlocks || [];

	const mergedInner = origInner.map((origChild, i) => {
		if (i < newInner.length && origChild.name === newInner[i].name) {
			return buildSafeBlockTree(origChild, newInner[i]);
		}
		// No matching AI block at this position — keep original unchanged
		return cloneBlockTree(origChild);
	});

	const mergedAttrs = mergeBlockAttributes(
		originalBlock.attributes || {},
		newParsed.attributes || {}
	);
	return createBlock(originalBlock.name, mergedAttrs, mergedInner);
}

async function handleEditBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	const validation = validateBlockMarkup(args.block_content);
	if (!validation.valid) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) }],
			isError: true,
		};
	}

	let finalContent = validation.correctedContent || args.block_content;

	// ── Safe attribute-merge path ──
	// When the original block has inner blocks, protect them by merging
	// AI attributes into the original tree instead of full replacement.
	const { select: wpSelect } = wp.data;
	const originalBlock = wpSelect("core/block-editor").getBlock(args.client_id);

	if (originalBlock && originalBlock.innerBlocks.length > 0 && validation.blocks?.length >= 1) {
		const newTopBlock = validation.blocks[0];

		if (innerBlockStructureMatches(originalBlock, newTopBlock)) {
			// Structure matches → safe merge: AI's attributes + original structure
			const safeTree = buildSafeBlockTree(originalBlock, newTopBlock);
			finalContent = serialize(safeTree);
			console.log(
				"[handleEditBlock] Safe attribute-merge path for",
				originalBlock.name,
				"— inner blocks preserved"
			);
		} else {
			// Structure changed — reject if inner blocks were lost
			const origCount = countInnerBlocks(originalBlock);
			const newCount = countInnerBlocks(newTopBlock);

			if (origCount >= 2 && newCount === 0) {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `STRUCTURAL ERROR: The replacement markup has 0 inner blocks but the original has ${origCount}. You MUST preserve all inner blocks when editing. To change only wrapper attributes (background color, text color, spacing), modify ONLY the opening block comment JSON and the outermost HTML tag classes — copy ALL inner blocks byte-for-byte from the original markup.`,
							}),
						},
					],
					isError: true,
				};
			}

			if (origCount >= 3 && newCount < origCount * 0.5) {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `STRUCTURAL ERROR: The replacement markup has ${newCount} inner blocks but the original has ${origCount}. You appear to have lost inner blocks. Preserve all inner blocks exactly — only change what the user asked for.`,
							}),
						},
					],
					isError: true,
				};
			}
			// Structure intentionally changed (different block types, reordering)
			// — fall through to full replacement
		}
	}

	// ── Apply the edit ──
	await ctx.updateProgress(__("Editing block content…", "wp-module-editor-chat"), 400);
	try {
		const editResult = await handleRewriteAction(args.client_id, finalContent);
		await ctx.updateProgress(__("Block updated successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: true, message: editResult.message }),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (editError) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: false, error: editError.message }),
				},
			],
			isError: true,
		};
	}
}

async function handleAddSection(toolCall, args, ctx) {
	// When pattern_slug is provided, fetch markup directly from the library
	if (args.pattern_slug && !args.block_content) {
		await ctx.updateProgress(__("Fetching pattern from library…", "wp-module-editor-chat"), 400);
		try {
			const pattern = await patternLibrary.getMarkup(args.pattern_slug);
			if (pattern && pattern.content) {
				args.block_content = pattern.content;
			} else {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `Pattern "${args.pattern_slug}" not found`,
							}),
						},
					],
					isError: true,
				};
			}
		} catch (fetchErr) {
			return {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({ success: false, error: fetchErr.message }),
					},
				],
				isError: true,
			};
		}
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	const validation = validateBlockMarkup(args.block_content);
	if (!validation.valid) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) }],
			isError: true,
		};
	}

	// Use auto-corrected content if the validator fixed class order / missing meta-classes
	const finalAddContent = validation.correctedContent || args.block_content;

	// Force constrained layout on the outermost block comment
	let sectionContent = finalAddContent;
	try {
		const commentEnd = sectionContent.indexOf("-->");
		if (commentEnd !== -1) {
			const comment = sectionContent.substring(0, commentEnd + 3);
			const nameMatch = comment.match(/<!-- wp:(\S+)/);
			if (nameMatch) {
				const blockName = nameMatch[1];
				const braceStart = comment.indexOf("{");
				const braceEnd = comment.lastIndexOf("}");

				let attrs = {};
				if (braceStart !== -1 && braceEnd > braceStart) {
					attrs = JSON.parse(comment.substring(braceStart, braceEnd + 1));
				}

				if (!attrs.layout) {
					attrs.layout = { type: "constrained" };
					const newComment = `<!-- wp:${blockName} ${JSON.stringify(attrs)} -->`;
					sectionContent = newComment + sectionContent.substring(commentEnd + 3);
				}
			}
		}
	} catch (layoutErr) {
		console.warn("Failed to enforce constrained layout:", layoutErr);
	}

	await ctx.updateProgress(__("Adding new section…", "wp-module-editor-chat"), 400);
	try {
		const afterClientId = args.after_client_id || null;
		const addResult = await handleAddAction(afterClientId, [{ block_content: sectionContent }]);
		await ctx.updateProgress(__("Section added successfully", "wp-module-editor-chat"), 500);

		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({
						success: true,
						message: addResult.message,
						blocksAdded: addResult.blocksAdded,
					}),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (addError) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: addError.message }) }],
			isError: true,
		};
	}
}

async function handleDeleteBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Deleting block…", "wp-module-editor-chat"), 400);
	try {
		const deleteResult = await handleDeleteAction(args.client_id);
		await ctx.updateProgress(__("Block deleted successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: true, message: deleteResult.message }),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (deleteError) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: false, error: deleteError.message }),
				},
			],
			isError: true,
		};
	}
}

async function handleMoveBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Moving block…", "wp-module-editor-chat"), 400);
	try {
		const moveResult = await handleMoveAction(args.client_id, args.target_client_id, args.position);
		await ctx.updateProgress(__("Block moved successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: true, message: moveResult.message }),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (moveError) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: false, error: moveError.message }),
				},
			],
			isError: true,
		};
	}
}

async function handleGetBlockMarkup(toolCall, args, ctx) {
	await ctx.updateProgress(__("Reading block markup…", "wp-module-editor-chat"), 300);
	const markupResult = getBlockMarkup(args.client_id);
	if (markupResult) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(markupResult) }],
			isError: false,
		};
	}
	return {
		id: toolCall.id,
		result: [
			{
				type: "text",
				text: JSON.stringify({
					error: `Block with clientId ${args.client_id} not found`,
				}),
			},
		],
		isError: true,
	};
}

async function handleHighlightBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Highlighting block…", "wp-module-editor-chat"), 300);
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const block = wpSelect("core/block-editor").getBlock(args.client_id);
	if (block) {
		wpDispatch("core/block-editor").selectBlock(args.client_id);
		wpDispatch("core/block-editor").flashBlock(args.client_id);
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: true, block_name: block.name }) }],
			isError: false,
		};
	}
	return {
		id: toolCall.id,
		result: [
			{
				type: "text",
				text: JSON.stringify({ error: `Block ${args.client_id} not found` }),
			},
		],
		isError: true,
	};
}

async function handleSearchPatterns(toolCall, args, ctx) {
	await ctx.updateProgress(__("Searching pattern library…", "wp-module-editor-chat"), 300);
	if (patternLibrary.isReady()) {
		const { results, totalMatches } = patternLibrary.search(args.query, {
			category: args.category,
			limit: args.limit || 15,
		});
		const resultText =
			results.length > 0
				? JSON.stringify({
						patterns: results,
						count: results.length,
						totalMatches,
					})
				: JSON.stringify({
						patterns: [],
						count: 0,
						totalMatches: 0,
						message: "No matching patterns found",
					});
		return {
			id: toolCall.id,
			result: [{ type: "text", text: resultText }],
			isError: false,
		};
	}
	// Fall through — caller will hit the default MCP path
	return null;
}

async function handleGetPatternMarkup(toolCall, args, ctx) {
	await ctx.updateProgress(__("Fetching pattern markup…", "wp-module-editor-chat"), 400);
	try {
		const pattern = await patternLibrary.getMarkup(args.slug);
		if (pattern && pattern.content) {
			return {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({
							slug: pattern.slug,
							title: pattern.title,
							content: pattern.content,
							categories: pattern.categories,
						}),
					},
				],
				isError: false,
			};
		}
	} catch (err) {
		console.warn("Client-side pattern fetch failed, falling back to MCP:", err);
	}
	// Fall through — caller will hit the default MCP path
	return null;
}

// ────────────────────────────────────────────────────────────────────
// WebSocket entry point (no follow-up AI call — Jarvis handles it)
// ────────────────────────────────────────────────────────────────────

/**
 * Execute tool calls received from the Jarvis WebSocket gateway.
 *
 * This function does NOT send a follow-up AI completion — Jarvis runs
 * tools server-side and generates the summary automatically. This
 * function only handles the client-side visual updates (block editing,
 * section adding, style changes, etc.).
 *
 * @param {Array}  toolCalls Tool calls parsed from the WebSocket `tool_call` event
 * @param {Object} ctx       Shared context object (same shape as useEditorChat's buildToolCtx)
 */
export async function executeToolCallsFromWebSocket(toolCalls, ctx) {
	const toolResults = [];
	const completedToolsList = [];
	let globalStylesUndoData = null;
	let hasBlockEdits = false;

	// Capture block snapshot before any tool execution for atomic undo
	const hasBlockTools = toolCalls.some((tc) => BLOCK_TOOL_NAMES.includes(tc.name || ""));
	if (hasBlockTools && !ctx.blockSnapshotRef.current) {
		const { select: wpSelect } = wp.data;
		const allBlocks = wpSelect("core/block-editor").getBlocks();
		ctx.blockSnapshotRef.current = snapshotBlocks(allBlocks);
	}

	// Brief pause before activating tool mode so the "Thinking…" indicator
	// stays visible between the reasoning text and the tool execution
	// accordion.  isTyping is kept true by the messageHandler so isLoading
	// remains true during this wait (no gap in the indicator).
	await ctx.wait(300);

	ctx.setStatus(CHAT_STATUS.TOOL_CALL);
	ctx.setActiveToolCall({
		id: "preparing",
		name: "preparing",
		index: 0,
		total: toolCalls.length,
	});

	ctx.setPendingTools(
		toolCalls.map((tc, idx) => ({
			...tc,
			id: tc.id || `tool-${idx}`,
		}))
	);

	for (let i = 0; i < toolCalls.length; i++) {
		const toolCall = toolCalls[i];
		const toolIndex = i + 1;
		const totalTools = toolCalls.length;

		ctx.setPendingTools((prev) => prev.filter((_, idx) => idx !== 0));
		ctx.setActiveToolCall({
			id: toolCall.id || `tool-${i}`,
			name: toolCall.name,
			arguments: toolCall.arguments,
			index: toolIndex,
			total: totalTools,
		});

		try {
			const toolName = toolCall.name || "";
			const args = toolCall.arguments || {};

			// Log invoked tool with its data
			console.log(`[tool] ${toolName}`, args);

			// ── blu/update-global-styles ──
			if (toolName === "blu-update-global-styles" && args.settings) {
				const gsResult = await handleUpdateGlobalStyles(toolCall, args, ctx);
				toolResults.push(gsResult.toolResult);
				const isError = gsResult.toolResult.isError;
				completedToolsList.push({ ...toolCall, isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError }]);
				if (gsResult.globalStylesUndoData) {
					globalStylesUndoData = gsResult.globalStylesUndoData;
				}
			}

			// ── blu/get-global-styles ──
			else if (toolName === "blu-get-global-styles") {
				const gsResult = await handleGetGlobalStyles(toolCall, ctx);
				if (gsResult) {
					toolResults.push(gsResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				} else {
					toolResults.push({ id: toolCall.id, result: null, isError: false });
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				}
			}

			// ── blu/edit-block ──
			else if (toolName === "blu-edit-block" && args.client_id && args.block_content) {
				const editResult = await handleEditBlock(toolCall, args, ctx);
				if (!editResult.isError && editResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(editResult);
				completedToolsList.push({ ...toolCall, isError: editResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: editResult.isError }]);
			}

			// ── blu/add-section ──
			else if (toolName === "blu-add-section" && (args.block_content || args.pattern_slug)) {
				const addResult = await handleAddSection(toolCall, args, ctx);
				if (!addResult.isError && addResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(addResult);
				completedToolsList.push({ ...toolCall, isError: addResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: addResult.isError }]);
			}

			// ── blu/delete-block ──
			else if (toolName === "blu-delete-block" && args.client_id) {
				const delResult = await handleDeleteBlock(toolCall, args, ctx);
				if (!delResult.isError && delResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(delResult);
				completedToolsList.push({ ...toolCall, isError: delResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: delResult.isError }]);
			}

			// ── blu/move-block ──
			else if (
				toolName === "blu-move-block" &&
				args.client_id &&
				args.target_client_id &&
				args.position
			) {
				const mvResult = await handleMoveBlock(toolCall, args, ctx);
				if (!mvResult.isError && mvResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(mvResult);
				completedToolsList.push({ ...toolCall, isError: mvResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: mvResult.isError }]);
			}

			// ── blu/get-block-markup ──
			else if (toolName === "blu-get-block-markup" && args.client_id) {
				const mkResult = await handleGetBlockMarkup(toolCall, args, ctx);
				toolResults.push(mkResult);
				completedToolsList.push({ ...toolCall, isError: mkResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: mkResult.isError }]);
			}

			// ── blu/highlight-block ──
			else if (toolName === "blu-highlight-block" && args.client_id) {
				const hlResult = await handleHighlightBlock(toolCall, args, ctx);
				toolResults.push(hlResult);
				completedToolsList.push({ ...toolCall, isError: hlResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: hlResult.isError }]);
			}

			// ── blu/search-patterns ──
			else if (toolName === "blu-search-patterns" && args.query) {
				const spResult = await handleSearchPatterns(toolCall, args, ctx);
				if (spResult) {
					toolResults.push(spResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				} else {
					toolResults.push({ id: toolCall.id, result: null, isError: false });
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				}
			}

			// ── blu/get-pattern-markup ──
			else if (toolName === "blu-get-pattern-markup" && args.slug) {
				const pmResult = await handleGetPatternMarkup(toolCall, args, ctx);
				if (pmResult) {
					toolResults.push(pmResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				} else {
					toolResults.push({ id: toolCall.id, result: null, isError: false });
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				}
			}

			// ── Default: skip unrecognized tools ──
			// The gateway executes all tools server-side via MCP.
			// Only editor-specific tools (block editing, styles) need client-side execution.
			else {
				toolResults.push({ id: toolCall.id, result: null, isError: false });
				completedToolsList.push({ ...toolCall, isError: false });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
			}

			// ── Send result back to the backend to unblock the MCP server ──
			if (ctx.sendToolResult) {
				try {
					const lastResult = toolResults[toolResults.length - 1];
					const backendToolName = toolName.replace("blu-", "blu/");
					let payload;
					if (lastResult?.result?.[0]?.text) {
						payload = JSON.parse(lastResult.result[0].text);
					} else if (lastResult?.error) {
						payload = { success: false, error: lastResult.error };
					} else {
						payload = { success: !lastResult?.isError };
					}
					ctx.sendToolResult(toolCall.id, backendToolName, payload);
				} catch (sendErr) {
					console.warn("[toolExecutor] Failed to send tool result:", sendErr);
				}
			}
		} catch (err) {
			console.error(`Tool call ${toolCall.name} failed:`, err);
			await ctx.updateProgress(
				__("Action failed:", "wp-module-editor-chat") + " " + err.message,
				1000
			);
			toolResults.push({ id: toolCall.id, result: null, error: err.message });
			completedToolsList.push({ ...toolCall, isError: true, errorMessage: err.message });
			ctx.setExecutedTools((prev) => [
				...prev,
				{ ...toolCall, isError: true, errorMessage: err.message },
			]);

			// Send error back to unblock the backend
			if (ctx.sendToolResult) {
				try {
					const backendToolName = (toolCall.name || "").replace("blu-", "blu/");
					ctx.sendToolResult(toolCall.id, backendToolName, { success: false, error: err.message });
				} catch (sendErr) {
					console.warn("[toolExecutor] Failed to send tool error:", sendErr);
				}
			}
		}
	}

	const hasChanges = toolResults.some((r) => r.hasChanges);

	// Build composite undo data from both block snapshot and global styles
	let compositeUndoData = null;
	if (hasChanges) {
		const undoParts = {};
		if (hasBlockEdits && ctx.blockSnapshotRef.current) {
			undoParts.blocks = ctx.blockSnapshotRef.current;
		}
		if (globalStylesUndoData) {
			undoParts.globalStyles = globalStylesUndoData;
		}
		if (Object.keys(undoParts).length > 0) {
			compositeUndoData = undoParts;
		}
	}

	// Insert a dedicated tool_execution message right after the reasoning
	// message so it appears between reasoning and the result.  The backend
	// streams result chunks while client-side tools are still running, so
	// result messages may already be in the array — splicing after the
	// reasoning landmark keeps the correct visual order.
	if (compositeUndoData || completedToolsList.length > 0) {
		const toolExecMsg = {
			id: `tool-exec-${Date.now()}`,
			role: "assistant",
			type: "tool_execution",
			executedTools: [...completedToolsList],
			...(compositeUndoData ? { hasActions: true, undoData: compositeUndoData } : {}),
			timestamp: new Date(),
		};

		ctx.setMessages((prev) => {
			// Find the reasoning message flushed by the tool_call handler
			// (messageHandler adds the "-reasoning" suffix to its ID).
			let insertIdx = -1;
			for (let i = prev.length - 1; i >= 0; i--) {
				if (prev[i].id?.endsWith("-reasoning")) {
					insertIdx = i + 1;
					break;
				}
			}
			// Fallback: insert after the last user message
			if (insertIdx === -1) {
				for (let i = prev.length - 1; i >= 0; i--) {
					if (prev[i].role === "user") {
						insertIdx = i + 1;
						break;
					}
				}
			}
			// Last resort: append at end
			if (insertIdx === -1) {
				return [...prev, toolExecMsg];
			}
			return [...prev.slice(0, insertIdx), toolExecMsg, ...prev.slice(insertIdx)];
		});
	}

	// Persist ref for SUMMARIZING status, then clear state to remove TypingIndicator duplicate
	if (completedToolsList.length > 0) {
		ctx.executedToolsRef.current = [...completedToolsList];
		ctx.setExecutedTools([]);
	}

	// Clear tool execution UI state
	ctx.setActiveToolCall(null);
	ctx.setToolProgress(null);
	ctx.setPendingTools([]);
	// Don't set isLoading = false or status = null — WebSocket hook manages those
}
