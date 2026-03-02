/* eslint-disable no-undef, no-console */
/**
 * Tool executor — handles MCP/client-side tool calls from the AI.
 *
 * Extracted from useEditorChat.js so the hook stays a slim orchestrator.
 * Receives a `ctx` object with all the clients, state setters, refs, and
 * helpers it needs — no direct React dependency.
 */
import { CHAT_STATUS } from "@newfold-labs/wp-module-ai-chat";
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


/** Max retry attempts for sending tool results back to the gateway. */
const SEND_RESULT_MAX_RETRIES = 3;
/** Base delay (ms) between retries — multiplied by attempt number. */
const SEND_RESULT_RETRY_DELAY = 800;

/**
 * Send a tool result back to the gateway with retry.
 *
 * The gateway blocks for up to 15 s waiting for this result. If the
 * WebSocket is momentarily disconnected (e.g. brief network glitch),
 * retrying prevents a false "editor is unresponsive" timeout.
 *
 * @param {Object} ctx       Shared context from useEditorChat
 * @param {string} toolCallId  The tool call ID
 * @param {string} toolName    The backend-format tool name (e.g. "blu/edit-block")
 * @param {Object} payload     The result payload to send
 * @return {Promise<boolean>}  Whether the result was successfully sent
 */
async function sendToolResultWithRetry(ctx, toolCallId, toolName, payload) {
	for (let attempt = 1; attempt <= SEND_RESULT_MAX_RETRIES; attempt++) {
		const sent = ctx.sendToolResult(toolCallId, toolName, payload);
		if (sent) {
			return true;
		}
		if (attempt < SEND_RESULT_MAX_RETRIES) {
			const delay = SEND_RESULT_RETRY_DELAY * attempt;
			console.warn(
				`[toolExecutor] Tool result send failed (attempt ${attempt}/${SEND_RESULT_MAX_RETRIES}), retrying in ${delay}ms…`
			);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
	console.error(
		`[toolExecutor] Failed to send tool result for "${toolName}" after ${SEND_RESULT_MAX_RETRIES} attempts — gateway will time out.`
	);
	return false;
}

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

		// ── Wrapper/child mismatch recovery ──
		// The AI may target a wrapper block (e.g., core/buttons) but send
		// content for an inner block (e.g., core/button). When the original
		// has exactly one inner block matching the AI's block type, redirect
		// the edit to that inner block to avoid replacing the wrapper.
		if (
			newTopBlock.name !== originalBlock.name &&
			originalBlock.innerBlocks.length === 1 &&
			originalBlock.innerBlocks[0].name === newTopBlock.name
		) {
			const innerBlock = originalBlock.innerBlocks[0];
			console.log(
				"[handleEditBlock] Redirecting edit from wrapper",
				originalBlock.name,
				"to inner block",
				innerBlock.name,
				innerBlock.clientId
			);
			args.client_id = innerBlock.clientId;
			// Inner block has no further inner blocks — skip safe merge, use
			// full replacement path below.
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
	// Filter out server-side-only tools (discovery, site listing, etc.).
	// These are already executed by Semantic Kernel on the backend —
	// the frontend only needs to handle client-side editor tools (blu-*).
	const clientToolCalls = toolCalls.filter((tc) => {
		const name = tc.name || "";
		if (!name.startsWith("blu-")) {
			console.log(`[toolExecutor] Skipping server-side tool: ${name}`);
			return false;
		}
		return true;
	});

	if (clientToolCalls.length === 0) {
		return;
	}

	// Replace toolCalls with the filtered list for the rest of this function
	toolCalls = clientToolCalls;

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

			// ── Send result back to the backend ──
			// Only for client-side tools (blu-* prefix). Server-side tools like
			// get_available_wordpress_actions are already executed by Semantic
			// Kernel — sending a stub result causes the backend to misinterpret
			// it as a new user message, creating an infinite loop.
			const isClientSideTool = toolName.startsWith("blu-");
			if (isClientSideTool && ctx.sendToolResult) {
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
					await sendToolResultWithRetry(ctx, toolCall.id, backendToolName, payload);
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

			// Send error back to unblock the backend (only for client-side tools)
			const errToolName = toolCall.name || "";
			if (errToolName.startsWith("blu-") && ctx.sendToolResult) {
				try {
					const backendToolName = errToolName.replace("blu-", "blu/");
					await sendToolResultWithRetry(ctx, toolCall.id, backendToolName, {
						success: false,
						error: err.message,
					});
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
