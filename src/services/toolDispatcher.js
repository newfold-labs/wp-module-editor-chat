/* eslint-disable no-undef */
/**
 * Tool dispatcher — routes AI tool calls (OpenAI function-calling format)
 * to the matching handler in services/toolHandlers/.
 *
 * Responsibilities:
 *   - separate client-side (blu-*) and server-side (MCP) tools
 *   - capture a block snapshot for atomic undo before any mutation
 *   - normalize arg aliases the AI commonly emits
 *   - upsert the single tool_execution message that drives the chat UI
 *
 * Per-tool logic (image dedup, validation, progress, etc.) lives in each
 * handler file. Gutenberg DOM mutations live in services/blockActions.js.
 */
import { CHAT_STATUS } from "@newfold/wp-module-ai-chat";
import { __ } from "@wordpress/i18n";

import { snapshotBlocks } from "../utils/editorContext";
import { safeParseJSON } from "../utils/jsonUtils";
import { callAbility } from "./callAbility";
import { handleContentCreation, CREATE_ABILITIES } from "./contentNavigation";
import {
	appendGeneratedImageUrl,
	getActiveImageEditTarget,
	resetGeneratedImageCache,
} from "./imageCache";
import { handleAddSection } from "./toolHandlers/addSection";
import { handleDeleteBlock } from "./toolHandlers/deleteBlock";
import { handleDuplicate } from "./toolHandlers/duplicate";
import { handleEditBlock } from "./toolHandlers/editBlock";
import { handleGetBlockMarkup } from "./toolHandlers/getBlockMarkup";
import { handleGetGlobalStyles, handleUpdateGlobalStyles } from "./toolHandlers/globalStyles";
import { handleHighlightBlock } from "./toolHandlers/highlightBlock";
import { handleInsertInnerBlock } from "./toolHandlers/insertInnerBlock";
import { handleMoveBlock } from "./toolHandlers/moveBlock";
import { handleRegenerateLogo } from "./toolHandlers/regenerateLogo";
import { handleUpdateBlockAttrs } from "./toolHandlers/updateBlockAttrs";
import { handleEditImage } from "./toolHandlers/editImage";
import { callImageAbility, getBlockImageUrl, parseImageAbilityUrl } from "./imageAbility";
import { IMAGE_BLOCKS } from "./blockToolbar/blockAI";
import logger from "../utils/logger";

// Re-export so external callers (e.g. useEditorChatREST) keep working.
export { resetGeneratedImageCache };

/**
 * Create or replace the single tool_execution message for the current turn.
 * Caller passes the COMPLETE list of tools; any existing message is replaced
 * (not appended) so duplicates are impossible across multi-round calls.
 *
 * @param {Function} setMessages React state setter for messages
 * @param {Array}    tools       Complete list of tool objects for this turn
 * @param {Object}   [undoData]  Optional undo data for accept/decline
 */
export function upsertToolExecMsg(setMessages, tools, undoData) {
	if (!tools || tools.length === 0) {
		return;
	}

	setMessages((prev) => {
		// Scope: only merge with a tool_execution after the last user message
		let lastUserIdx = -1;
		let lastUserId = "turn";
		for (let i = prev.length - 1; i >= 0; i--) {
			if (prev[i].role === "user") {
				lastUserIdx = i;
				lastUserId = prev[i].id || `user-${i}`;
				break;
			}
		}

		const stableToolExecId = `tool-exec-${lastUserId}`;

		// Find existing tool_execution message in the current turn
		let existingIdx = -1;
		for (let i = prev.length - 1; i > lastUserIdx; i--) {
			if (prev[i].type === "tool_execution") {
				existingIdx = i;
				break;
			}
		}

		if (existingIdx !== -1) {
			const existing = prev[existingIdx];
			const updated = {
				...existing,
				id: existing.id || stableToolExecId,
				executedTools: [...tools],
				...(undoData ? { hasActions: true, undoData } : {}),
			};
			return [...prev.slice(0, existingIdx), updated, ...prev.slice(existingIdx + 1)];
		}

		// Create new — append at end of turn so plan preamble stays above actions.
		const toolExecMsg = {
			id: stableToolExecId,
			role: "assistant",
			type: "tool_execution",
			executedTools: [...tools],
			...(undoData ? { hasActions: true, undoData } : {}),
			timestamp: new Date(),
		};

		let afterReasoningIdx = -1;
		for (let i = prev.length - 1; i > lastUserIdx; i--) {
			if (prev[i].id?.endsWith("-reasoning")) {
				afterReasoningIdx = i + 1;
				break;
			}
		}
		if (afterReasoningIdx > -1) {
			return [...prev.slice(0, afterReasoningIdx), toolExecMsg, ...prev.slice(afterReasoningIdx)];
		}

		return [...prev, toolExecMsg];
	});
}

/** Block-mutating tool names that require a snapshot for undo. */
const BLOCK_TOOL_NAMES = [
	"blu-edit-block",
	"blu-add-section",
	"blu-delete-block",
	"blu-duplicate-block",
	"blu-insert-inner-block",
	"blu-move-block",
	"blu-update-block-attrs",
];

// ─────────────────────────────────────────────────────────────
// Tool execution (for CF AI Gateway / OpenAI function calling)
// ─────────────────────────────────────────────────────────────

/**
 * Tools that return data the model needs (read-only tools).
 * For these, we send the actual result content back to the AI.
 * For write tools, we just send "Applied successfully" / error.
 */
const READ_TOOLS = new Set([
	"blu-get-block-markup",
	"blu-get-global-styles",
	"blu-highlight-block",
	"blu-generate-image",
	"blu-regenerate-logo",
	"blu-edit-image",
	// Gateway tools return data the model needs — pass their full content through.
	// Without these the LLM receives "No changes needed" instead of the ability
	// list/schema, causing it to loop indefinitely without finding the ability.
	"blu-list-abilities",
	"blu-get-ability-schema",
]);

/**
 * Execute tool calls for the function-calling loop.
 *
 * - RETURNS results (for appending to conversation as tool messages)
 * - Executes server-side tools via mcpClient.callTool()
 *
 * @param {Array}  toolCalls Tool calls from the OpenAI streaming response
 * @param {Object} ctx       Shared context object with clients, state setters, refs, helpers
 * @return {Promise<Array>}  Array of { tool_call_id, content, isError } for the conversation
 */
export async function executeToolCallsForREST(toolCalls, ctx) {
	const toolResults = [];
	const completedToolsList = [];
	let globalStylesUndoData = null;
	let hasBlockEdits = false;

	// Separate client-side (blu-*) and server-side tools
	const clientToolCalls = [];
	const serverToolCalls = [];
	for (const tc of toolCalls) {
		const name = tc.name || "";
		if (name.startsWith("blu-")) {
			clientToolCalls.push(tc);
		} else {
			serverToolCalls.push(tc);
		}
	}

	// Execute server-side tools via MCP
	for (const tc of serverToolCalls) {
		const mcpName = tc.name || "";
		try {
			const mcpResult = await ctx.mcpClient.callTool(mcpName, tc.arguments || {});
			const content = typeof mcpResult === "string" ? mcpResult : JSON.stringify(mcpResult);
			toolResults.push({
				tool_call_id: tc.id,
				content,
				isError: false,
			});
			completedToolsList.push({ ...tc, isError: false });
			ctx.setExecutedTools((prev) => [...prev, { ...tc, isError: false }]);
		} catch (err) {
			toolResults.push({
				tool_call_id: tc.id,
				content: JSON.stringify({ error: err.message }),
				isError: true,
			});
			completedToolsList.push({ ...tc, isError: true, errorMessage: err.message });
			ctx.setExecutedTools((prev) => [
				...prev,
				{ ...tc, isError: true, errorMessage: err.message },
			]);
		}
	}

	if (clientToolCalls.length === 0) {
		return toolResults;
	}

	// Capture block snapshot before any tool execution for atomic undo
	const hasBlockTools = clientToolCalls.some((tc) => BLOCK_TOOL_NAMES.includes(tc.name || ""));
	if (hasBlockTools && !ctx.blockSnapshotRef.current) {
		const { select: wpSelect } = wp.data;
		const allBlocks = wpSelect("core/block-editor").getBlocks();
		ctx.blockSnapshotRef.current = snapshotBlocks(allBlocks);
	}

	await ctx.wait(300);
	ctx.setStatus(CHAT_STATUS.TOOL_CALL);
	ctx.setActiveToolCall({
		id: "preparing",
		name: "preparing",
		index: 0,
		total: clientToolCalls.length,
	});
	ctx.setPendingTools(
		clientToolCalls.map((tc, idx) => ({
			...tc,
			id: tc.id || `tool-${idx}`,
		}))
	);

	// Execute client-side tools sequentially
	for (let i = 0; i < clientToolCalls.length; i++) {
		let toolCall = clientToolCalls[i];
		const toolIndex = i + 1;
		const totalTools = clientToolCalls.length;

		ctx.setPendingTools((prev) => prev.filter((_, idx) => idx !== 0));
		ctx.setActiveToolCall({
			id: toolCall.id || `tool-${i}`,
			name: toolCall.name,
			arguments: toolCall.arguments,
			index: toolIndex,
			total: totalTools,
		});

		await new Promise((r) => requestAnimationFrame(r));

		try {
			let toolName = toolCall.name || "";
			logger.log(
				`[ToolExecutor:REST] Executing ${toolIndex}/${totalTools}: ${toolName}`,
				toolCall.arguments
			);
			let args = toolCall.arguments || {};
			if (typeof args === "string") {
				args = safeParseJSON(args).value;
			}

			// Unwrap gateway calls: blu-call-ability wraps an inner ability name
			// and parameters. Extract them so client-side handlers can execute,
			// and so the UI shows the real ability name (e.g. "Delete Block").
			// Models sometimes emit the slash form ("blu/edit-block") that matches
			// how abilities are registered server-side; MCP's tools/list exposes
			// the hyphen form, so normalize here before dispatch.
			if (toolName === "blu-call-ability" && args.ability_name) {
				toolName = String(args.ability_name).replace(/\//g, "-");
				args = args.parameters || {};
				toolCall = { ...toolCall, name: toolName };
			}

			// Normalize alt param names
			if (!args.client_id && args.clientId) {
				args.client_id = args.clientId;
			}
			// The model commonly sends `instruction` (singular) even though the
			// ability schema is `instructions` — accept both.
			if (!args.instructions && args.instruction) {
				args.instructions = args.instruction;
			}
			if (
				(toolName === "blu-edit-block" || toolName === "blu-add-section") &&
				!args.block_content
			) {
				const alt = args.content || args.markup || args.html || args.block_markup;
				if (alt) {
					args.block_content = alt;
				}
			}

			// edit-block without client_id → treat as add-section
			if (toolName === "blu-edit-block" && !args.client_id && args.block_content) {
				toolName = "blu-add-section";
			}

			let result;

			// Dispatch to tool handlers
			if (
				toolName === "blu-update-global-styles" &&
				(args.settings || args.palette || args.styles)
			) {
				// Normalize: AI commonly sends { palette: [...] } instead of { settings: { color: { palette: { theme: [...] } } } }
				if (!args.settings && args.palette) {
					args.settings = { color: { palette: { theme: args.palette } } };
				}
				const gsResult = await handleUpdateGlobalStyles(toolCall, args, ctx);
				result = gsResult.toolResult;
				if (gsResult.globalStylesUndoData) {
					globalStylesUndoData = gsResult.globalStylesUndoData;
				}
			} else if (
				toolName === "blu-get-global-styles" ||
				toolName === "blu-get-active-global-styles"
			) {
				result = await handleGetGlobalStyles(toolCall, ctx);
			} else if (toolName === "blu-edit-block" && args.client_id && args.block_content) {
				result = await handleEditBlock(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) {
					hasBlockEdits = true;
				}
			} else if (toolName === "blu-add-section" && args.block_content) {
				result = await handleAddSection(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) {
					hasBlockEdits = true;
				}
			} else if (toolName === "blu-delete-block" && args.client_id) {
				result = await handleDeleteBlock(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) {
					hasBlockEdits = true;
				}
			} else if (toolName === "blu-duplicate-block" && (args.client_id || args.kind)) {
				result = await handleDuplicate(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) {
					hasBlockEdits = true;
				}
			} else if (
				toolName === "blu-insert-inner-block" &&
				args.parent_client_id &&
				args.block_content
			) {
				result = await handleInsertInnerBlock(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) {
					hasBlockEdits = true;
				}
			} else if (
				toolName === "blu-move-block" &&
				args.client_id &&
				((args.target_client_id && args.position) || args.as_child_of)
			) {
				result = await handleMoveBlock(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) {
					hasBlockEdits = true;
				}
			} else if (toolName === "blu-get-block-markup" && args.client_id) {
				result = await handleGetBlockMarkup(toolCall, args, ctx);
			} else if (toolName === "blu-highlight-block" && args.client_id) {
				result = await handleHighlightBlock(toolCall, args, ctx);
			} else if (toolName === "blu-update-block-attrs" && args.client_id) {
				if (!args.attributes) {
					// Preserve handler-level params that aren't block attributes
					const { client_id: clientId, image_prompt: imagePrompt, ...rest } = args;
					if (Object.keys(rest).length > 0) {
						args = { client_id: clientId, attributes: rest };
					} else {
						args = { client_id: clientId, attributes: {} };
					}
					if (imagePrompt) {
						args.image_prompt = imagePrompt;
					}
				}
				if (args.attributes || args.image_prompt) {
					result = await handleUpdateBlockAttrs(toolCall, args, ctx);
					if (!result.isError && result.hasChanges) {
						hasBlockEdits = true;
					}
				}
			} else if (toolName === "blu-edit-image") {
				if (args.prompt && args.source_url) {
					result = await handleEditImage(toolCall, args, ctx);
				} else {
					result = {
						id: toolCall.id,
						result: [
							{
								type: "text",
								text: JSON.stringify({
									error:
										"Missing required parameters: prompt and source_url. Use blu-edit-image to modify an existing image URL.",
								}),
							},
						],
						isError: true,
					};
				}
			} else if (toolName === "blu-generate-image" && args.prompt) {
				// If the targeted block already has an image, redirect to blu-edit-image
				// so we modify the existing photo rather than discarding it and
				// generating a brand-new one. Resolve the block from (in priority order):
				// the explicit client_id arg, the active image-edit target recorded when
				// the request was sent, then the live selection. The active target is the
				// reliable signal — the chat sidebar steals canvas selection, so
				// getSelectedBlock() is often null by the time tools dispatch.
				const targetClientId = args.client_id || getActiveImageEditTarget() || null;
				const targetBlock = targetClientId
					? wp.data.select("core/block-editor").getBlock(targetClientId)
					: wp.data.select("core/block-editor").getSelectedBlock();
				const sourceUrl =
					targetBlock && IMAGE_BLOCKS.has(targetBlock.name) ? getBlockImageUrl(targetBlock) : null;

				const progressLabel = sourceUrl
					? __("Editing image…", "wp-module-editor-chat")
					: __("Generating image…", "wp-module-editor-chat");
				await ctx.updateProgress(progressLabel, 500);
				try {
					const mcpResult = await callImageAbility(ctx.mcpClient, {
						prompt: args.prompt,
						sourceUrl,
					});
					const url = parseImageAbilityUrl(mcpResult);
					if (url) {
						appendGeneratedImageUrl(url);
						if (targetBlock && IMAGE_BLOCKS.has(targetBlock.name)) {
							wp.data
								.dispatch("core/block-editor")
								.updateBlockAttributes(targetBlock.clientId, { url, id: 0 });
						}
					}
					result = {
						id: toolCall.id,
						result: [
							{
								type: "text",
								text: JSON.stringify(
									url
										? {
												success: true,
												message: sourceUrl ? "Image edited." : "Image generated.",
												url,
											}
										: { success: false, error: "No image URL returned." }
								),
							},
						],
						isError: mcpResult.isError || !url,
					};
				} catch (err) {
					result = {
						id: toolCall.id,
						result: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
						isError: true,
					};
				}
			} else if (toolName === "blu-regenerate-logo") {
				if (!args.prompt) {
					result = {
						id: toolCall.id,
						result: [
							{
								type: "text",
								text: JSON.stringify({
									error:
										"Missing required parameter: prompt. Describe the logo to generate (brand name, style, colors).",
								}),
							},
						],
						isError: true,
					};
				} else {
					result = await handleRegenerateLogo(toolCall, args, ctx);
				}
			} else {
				// Server-side MCP tool — forward to MCP server for execution
				logger.log(`[ToolExecutor:REST] Forwarding to MCP: ${toolName}`, args);
				try {
					const mcpResult = await callAbility(ctx.mcpClient, toolName, args);
					result = {
						id: toolCall.id,
						result: mcpResult.content,
						isError: mcpResult.isError || false,
					};
				} catch (mcpErr) {
					result = {
						id: toolCall.id,
						result: [
							{ type: "text", text: JSON.stringify({ success: false, error: mcpErr.message }) },
						],
						isError: true,
					};
				}
			}

			// Build tool result for conversation
			const isError = result?.isError ?? false;
			let creationMeta = null;
			let content;
			if (isError) {
				content = result.error || result.result?.[0]?.text || "Tool failed";
			} else if (READ_TOOLS.has(toolName) && result?.result?.[0]?.text) {
				content = result.result[0].text;
			} else if (CREATE_ABILITIES.has(toolName) && result?.result?.[0]?.text) {
				creationMeta = await handleContentCreation(toolName, result, ctx);
				if (creationMeta) {
					content = JSON.stringify({
						success: true,
						created: creationMeta,
					});
				} else {
					content = result.result[0].text;
				}
			} else {
				// Extract human-readable .message from handler's JSON result
				const msg = (() => {
					try {
						return JSON.parse(result?.result?.[0]?.text)?.message;
					} catch {
						return null;
					}
				})();
				content = result?.hasChanges ? msg || "Applied successfully" : "No changes needed";
			}

			// Log every client tool's outcome (with the failure reason) so the full
			// sequence is visible when debug logging is enabled. Many "failures" are
			// benign — the model retries with a different tool/target and still
			// completes the action (e.g. "Block not found" from a stale client_id).
			logger.log(
				`[ToolExecutor:REST] ${isError ? "✗ FAILED" : "✓ ok"}: ${toolName} →`,
				content,
				isError ? toolCall.arguments : ""
			);

			toolResults.push({
				tool_call_id: toolCall.id,
				content,
				isError,
				hasChanges: result?.hasChanges || false,
				isContentCreation: !!creationMeta,
				creationMeta,
			});
			completedToolsList.push({ ...toolCall, isError });
			ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError }]);
		} catch (err) {
			console.error(`[ToolExecutor:REST] Error executing ${toolCall.name}:`, err);
			await ctx.updateProgress(
				__("Action failed:", "wp-module-editor-chat") + " " + err.message,
				1000
			);
			toolResults.push({
				tool_call_id: toolCall.id,
				content: JSON.stringify({ error: err.message }),
				isError: true,
			});
			completedToolsList.push({ ...toolCall, isError: true, errorMessage: err.message });
			ctx.setExecutedTools((prev) => [
				...prev,
				{ ...toolCall, isError: true, errorMessage: err.message },
			]);
		}
	}

	// Build composite undo data
	const hasChanges = toolResults.some((r) => r.hasChanges);
	let compositeUndoData = null;
	if (hasChanges || hasBlockEdits) {
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

	// Persist tool execution as display message
	const refTools = ctx.executedToolsRef.current || [];
	const seenIds = new Set();
	const allCompletedTools = [];
	for (const t of [...refTools, ...completedToolsList]) {
		if (!seenIds.has(t.id)) {
			seenIds.add(t.id);
			allCompletedTools.push(t);
		}
	}

	if (compositeUndoData || allCompletedTools.length > 0) {
		upsertToolExecMsg(ctx.setMessages, allCompletedTools, compositeUndoData);
	}

	if (allCompletedTools.length > 0) {
		ctx.executedToolsRef.current = [...allCompletedTools];
		ctx.setExecutedTools([]);
	}

	// Clear tool execution UI state
	ctx.setActiveToolCall(null);
	ctx.setToolProgress(null);
	ctx.setPendingTools([]);

	return toolResults;
}
