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

import actionExecutor from "./actionExecutor";
import { getCurrentGlobalStyles, updateGlobalStyles } from "./globalStylesService";
import patternLibrary from "./patternLibrary";
import { customizePatternContent } from "./patternCustomizer";
import { getBlockMarkup, getCurrentPageTitle } from "../utils/editorHelpers";
import { validateBlockMarkup } from "../utils/blockValidator";
import { generateToolSummary, snapshotBlocks } from "../utils/editorContext";

/** Maximum depth for recursive tool-call chaining. */
const MAX_TOOL_DEPTH = 5;

/**
 * Chainable (read-only) tool names — after these, the model may call
 * additional tools rather than just summarising.
 */
const CHAINABLE_TOOLS = [
	"blu-get-block-markup",
	"blu-get-global-styles",
	"blu-highlight-block",
	"blu-search-patterns",
	"blu-get-pattern-markup",
	"blu-add-section",
];

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

	await ctx.updateProgress(__("Editing block content…", "wp-module-editor-chat"), 400);
	try {
		const editResult = await actionExecutor.handleRewriteAction(args.client_id, args.block_content);
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

		// Customize text content to match the page context
		await ctx.updateProgress(__("Customizing content…", "wp-module-editor-chat"), 400);
		const currentMessages = ctx.getMessages();
		const lastUserMsg = [...currentMessages].reverse().find((m) => m.type === "user");

		args.block_content = await customizePatternContent(
			args.block_content,
			{
				pageTitle: getCurrentPageTitle(),
				userMessage: lastUserMsg?.content || "",
			},
			ctx.openaiClient
		);
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

	// Force constrained layout on the outermost block comment
	let sectionContent = args.block_content;
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
		const addResult = await actionExecutor.handleAddAction(afterClientId, [
			{ block_content: sectionContent },
		]);
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
		const deleteResult = await actionExecutor.handleDeleteAction(args.client_id);
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
		const moveResult = await actionExecutor.handleMoveAction(
			args.client_id,
			args.target_client_id,
			args.position
		);
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
				: JSON.stringify({ patterns: [], count: 0, totalMatches: 0, message: "No matching patterns found" });
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
// Main entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Execute a batch of tool calls, then optionally chain into a follow-up
 * model call (up to MAX_TOOL_DEPTH).
 *
 * @param {Array}  toolCalls          Tool calls from OpenAI
 * @param {string} assistantMessageId ID of the assistant message that produced these calls
 * @param {Array}  previousMessages   Previous messages in OpenAI format
 * @param {string} assistantContent   Text content of the assistant turn
 * @param {number} depth              Current recursion depth (0-based)
 * @param {Object} ctx                Shared context object (see useEditorChat)
 */
export async function executeToolCalls(
	toolCalls,
	assistantMessageId,
	previousMessages,
	assistantContent,
	depth,
	ctx
) {
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

	ctx.setStatus(CHAT_STATUS.TOOL_CALL);
	await ctx.updateProgress(__("Preparing to execute actions…", "wp-module-editor-chat"), 300);

	if (depth === 0) {
		ctx.chainOriginRef.current = assistantMessageId;
		ctx.setExecutedTools([]);
	}

	ctx.setPendingTools(
		toolCalls.map((tc, idx) => ({
			...tc,
			id: tc.id || `tool-${idx}`,
		}))
	);

	const originId = ctx.chainOriginRef.current || assistantMessageId;
	ctx.setMessages((prev) =>
		prev.map((msg) => (msg.id === originId ? { ...msg, isExecutingTools: true } : msg))
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

			console.log({ toolCall });

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
				continue;
			}

			// ── blu/get-global-styles ──
			if (toolName === "blu-get-global-styles") {
				const gsResult = await handleGetGlobalStyles(toolCall, ctx);
				if (gsResult) {
					toolResults.push(gsResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					continue;
				}
				// Fall through to MCP
			}

			// ── blu/edit-block ──
			if (toolName === "blu-edit-block" && args.client_id && args.block_content) {
				const editResult = await handleEditBlock(toolCall, args, ctx);
				if (!editResult.isError && editResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(editResult);
				completedToolsList.push({ ...toolCall, isError: editResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: editResult.isError }]);
				continue;
			}

			// ── blu/add-section ──
			if (toolName === "blu-add-section" && (args.block_content || args.pattern_slug)) {
				const addResult = await handleAddSection(toolCall, args, ctx);
				if (!addResult.isError && addResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(addResult);
				completedToolsList.push({ ...toolCall, isError: addResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: addResult.isError }]);
				continue;
			}

			// ── blu/delete-block ──
			if (toolName === "blu-delete-block" && args.client_id) {
				const delResult = await handleDeleteBlock(toolCall, args, ctx);
				if (!delResult.isError && delResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(delResult);
				completedToolsList.push({ ...toolCall, isError: delResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: delResult.isError }]);
				continue;
			}

			// ── blu/move-block ──
			if (
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
				continue;
			}

			// ── blu/get-block-markup ──
			if (toolName === "blu-get-block-markup" && args.client_id) {
				const mkResult = await handleGetBlockMarkup(toolCall, args, ctx);
				toolResults.push(mkResult);
				completedToolsList.push({ ...toolCall, isError: mkResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: mkResult.isError }]);
				continue;
			}

			// ── blu/highlight-block ──
			if (toolName === "blu-highlight-block" && args.client_id) {
				const hlResult = await handleHighlightBlock(toolCall, args, ctx);
				toolResults.push(hlResult);
				completedToolsList.push({ ...toolCall, isError: hlResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: hlResult.isError }]);
				continue;
			}

			// ── blu/search-patterns ──
			if (toolName === "blu-search-patterns" && args.query) {
				const spResult = await handleSearchPatterns(toolCall, args, ctx);
				if (spResult) {
					toolResults.push(spResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					continue;
				}
				// Fall through to MCP fallback if index not ready
			}

			// ── blu/get-pattern-markup ──
			if (toolName === "blu-get-pattern-markup" && args.slug) {
				const pmResult = await handleGetPatternMarkup(toolCall, args, ctx);
				if (pmResult) {
					toolResults.push(pmResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					continue;
				}
				// Fall through to MCP fallback
			}

			// ── Default: MCP for all other tool calls ──
			await ctx.updateProgress(__("Communicating with WordPress…", "wp-module-editor-chat"), 400);
			const result = await ctx.mcpClient.callTool(toolCall.name, toolCall.arguments);
			await ctx.updateProgress(__("Processing response…", "wp-module-editor-chat"), 300);
			toolResults.push({ id: toolCall.id, result: result.content, isError: result.isError });
			completedToolsList.push({ ...toolCall, isError: result.isError });
			ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: result.isError }]);
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

	// Store toolResults on the message that owns the matching toolCalls (for API history),
	// and accumulate undoData on the chain origin.
	ctx.setMessages((prev) =>
		prev.map((msg) => {
			// When origin === current (depth 0), update everything on one message
			if (msg.id === originId && originId === assistantMessageId) {
				return {
					...msg,
					toolResults: [...(msg.toolResults || []), ...toolResults],
					isExecutingTools: true,
					...(compositeUndoData
						? {
								hasActions: true,
								undoData: {
									...(msg.undoData || {}),
									...compositeUndoData,
									...(msg.undoData?.blocks && compositeUndoData?.blocks
										? { blocks: msg.undoData.blocks }
										: {}),
								},
							}
						: {}),
				};
			}
			// Chained batch: pair toolResults with this message's toolCalls
			if (msg.id === assistantMessageId) {
				return {
					...msg,
					toolResults: [...(msg.toolResults || []), ...toolResults],
				};
			}
			// Chained batch: accumulate undoData on origin
			if (msg.id === originId) {
				return {
					...msg,
					isExecutingTools: true,
					...(compositeUndoData
						? {
								hasActions: true,
								undoData: {
									...(msg.undoData || {}),
									...compositeUndoData,
									...(msg.undoData?.blocks && compositeUndoData?.blocks
										? { blocks: msg.undoData.blocks }
										: {}),
								},
							}
						: {}),
				};
			}
			return msg;
		})
	);

	ctx.setActiveToolCall(null);
	ctx.setToolProgress(null);
	// Don't clear executedTools — they persist for TypingIndicator across batches
	ctx.setPendingTools([]);

	// Build the full message list with proper tool call / result format
	const assistantToolCallMessage = {
		role: "assistant",
		content: assistantContent || null,
		tool_calls: toolCalls.map((tc) => ({
			id: tc.id,
			type: "function",
			function: {
				name: tc.name,
				arguments: JSON.stringify(tc.arguments || {}),
			},
		})),
	};

	const toolResultMessages = toolResults.map((tr) => {
		let content;
		if (Array.isArray(tr.result)) {
			content = tr.result.map((item) => item.text || JSON.stringify(item)).join("\n");
		} else if (tr.error) {
			content = JSON.stringify({ error: tr.error });
		} else {
			content = JSON.stringify(tr.result);
		}
		return { role: "tool", tool_call_id: tr.id, content };
	});

	const allMessages = [...previousMessages, assistantToolCallMessage, ...toolResultMessages];

	const hasSuccessfulResults = toolResults.some((r) => !r.error);

	if (!hasSuccessfulResults) {
		ctx.finalizeChain();
		ctx.setStatus(null);
		ctx.setIsLoading(false);
		return;
	}

	// Follow up with the AI to get a response (summary or chained tool call).
	ctx.setStatus(CHAT_STATUS.SUMMARIZING);
	const hasChainableTool = toolCalls.some((tc) => CHAINABLE_TOOLS.includes(tc.name || ""));
	const canChain = hasChainableTool && depth < MAX_TOOL_DEPTH && ctx.mcpClient.isConnected();
	const openaiTools = canChain ? ctx.mcpClient.getToolsForOpenAI() : [];
	const followUpMessageId = `assistant-followup-${Date.now()}`;
	let followUpContent = "";

	ctx.setMessages((prev) => [
		...prev,
		{
			id: followUpMessageId,
			type: "assistant",
			role: "assistant",
			content: "",
			isStreaming: true,
		},
	]);

	// Retry with backoff on 429 rate limit errors
	const MAX_RETRIES = 3;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		if (attempt > 0) {
			const backoff = attempt * 2000;
			await ctx.wait(backoff);
			followUpContent = "";
		}

		try {
			await ctx.openaiClient.createStreamingCompletion(
				{
					model: "gpt-4.1-mini",
					messages: allMessages,
					tools: openaiTools.length > 0 ? openaiTools : undefined,
					tool_choice: openaiTools.length > 0 ? "auto" : undefined,
					temperature: 0.2,
					max_completion_tokens: 32000,
					mode: "editor",
				},
				(chunk) => {
					if (chunk.type === "reasoning") {
						ctx.setReasoningContent((prev) => prev + chunk.content);
					}
					if (chunk.type === "content") {
						ctx.setReasoningContent(""); // Clear reasoning when content starts
						followUpContent += chunk.content;
						ctx.setMessages((prev) =>
							prev.map((msg) =>
								msg.id === followUpMessageId ? { ...msg, content: followUpContent } : msg
							)
						);
					}
				},
				async (fullMessage, toolCallsResult, usage) => {
					if (usage) {
						ctx.setTokenUsage(usage);
					}

					const displayMessage =
						!fullMessage && toolCallsResult?.length > 0
							? generateToolSummary(toolCallsResult)
							: fullMessage;

					ctx.setReasoningContent("");

					ctx.setMessages((prev) =>
						prev.map((msg) =>
							msg.id === followUpMessageId
								? {
										...msg,
										content: displayMessage,
										isStreaming: false,
										toolCalls: toolCallsResult,
									}
								: msg
						)
					);

					if (toolCallsResult && toolCallsResult.length > 0 && canChain) {
						await executeToolCalls(
							toolCallsResult,
							followUpMessageId,
							allMessages,
							fullMessage,
							depth + 1,
							ctx
						);
						return;
					}

					ctx.finalizeChain();
					ctx.setStatus(null);
					ctx.setIsLoading(false);
				},
				(err) => {
					// Throw so the catch block can retry on 429
					throw err;
				}
			);
			// Success — break out of retry loop
			break;
		} catch (followUpError) {
			const is429 = followUpError?.message?.includes("429") || followUpError?.status === 429;
			if (is429 && attempt < MAX_RETRIES) {
				console.warn(
					`[CHAIN] Rate limited (429), will retry (attempt ${attempt + 1}/${MAX_RETRIES})`
				);
				continue;
			}
			// Final attempt failed or non-429 error — show what we have
			console.error("Follow-up failed:", followUpError);
			ctx.setMessages((prev) =>
				prev.map((msg) =>
					msg.id === followUpMessageId
						? { ...msg, content: followUpContent || "Done.", isStreaming: false }
						: msg
				)
			);
			ctx.finalizeChain();
			ctx.setStatus(null);
			ctx.setIsLoading(false);
			break;
		}
	}
}
