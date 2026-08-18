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

import {
	validateEntityContentArgs,
	abilityUsesBlockContent,
} from "../utils/entityContentValidation";
import { createAbortError } from "../utils/abortControl";
import { resolveAlt } from "../utils/imageAlt";
import { snapshotBlocks } from "../utils/editorContext";
import { safeParseJSON } from "../utils/jsonUtils";
import { callAbility, mcpResultIsError } from "./callAbility";
import { handleContentCreation, CREATE_ABILITIES } from "./contentNavigation";
import { findHeaderRefNavigationBlock, hydrateAllRefNavigationBlocks } from "./navigationEditor";
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
import { handleEditLogo } from "./toolHandlers/editLogo";
import { handleSetLogoFromImage } from "./toolHandlers/setLogoFromImage";
import { handleUpdateBlockAttrs } from "./toolHandlers/updateBlockAttrs";
import { handleEditImage } from "./toolHandlers/editImage";
import {
	applyImageToBlock,
	callImageAbility,
	getBlockImageUrl,
	parseImageAbilityUrl,
} from "./imageAbility";
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

/**
 * Short names the model often emits (from prompts or habit) instead of the
 * registered MCP hyphen names. Normalized after blu-call-ability unwrap.
 */
const BLOCK_TOOL_ALIASES = {
	"blu-duplicate": "blu-duplicate-block",
	"blu-delete": "blu-delete-block",
	"blu-insert": "blu-insert-inner-block",
	"blu-insert-block": "blu-insert-inner-block",
	"blu-update": "blu-update-block-attrs",
	"blu-update-attrs": "blu-update-block-attrs",
	"blu-move": "blu-move-block",
	"blu-edit": "blu-edit-block",
	"blu-add": "blu-add-section",
	"blu-add-block": "blu-add-section",
};

/** Server stub actions from block-editor abilities → client handler dispatch. */
const CLIENT_ACTION_TOOLS = {
	duplicate: "blu-duplicate-block",
	delete_block: "blu-delete-block",
	update_block_attrs: "blu-update-block-attrs",
	insert_inner_block: "blu-insert-inner-block",
	move_block: "blu-move-block",
	edit_block: "blu-edit-block",
	add_section: "blu-add-section",
};

function normalizeBlockToolName(toolName) {
	return BLOCK_TOOL_ALIASES[toolName] || toolName;
}

/**
 * Unwrap blu-call-ability and normalize slash/alias names to the client handler name.
 *
 * @param {string} toolName
 * @param {Object} args
 * @return {{ toolName: string, args: Object }} The unwrapped tool name and its arguments.
 */
function resolveClientToolCall(toolName, args) {
	let resolvedName = toolName || "";
	let resolvedArgs = args || {};

	if (typeof resolvedArgs === "string") {
		resolvedArgs = safeParseJSON(resolvedArgs).value || {};
	}

	if (resolvedName === "blu-call-ability" && resolvedArgs.ability_name) {
		// eslint-disable-next-line camelcase -- MCP payload field name, not ours to rename
		const { ability_name, parameters, ...rest } = resolvedArgs;
		resolvedName = String(ability_name).replace(/\//g, "-");

		let innerParams = parameters ?? {};
		if (typeof innerParams === "string") {
			innerParams = safeParseJSON(innerParams).value || {};
		}
		if (!innerParams || typeof innerParams !== "object" || Array.isArray(innerParams)) {
			innerParams = {};
		}

		// Models often emit ability params beside ability_name instead of inside `parameters`.
		resolvedArgs = { ...rest, ...innerParams };
	}

	return {
		toolName: normalizeBlockToolName(resolvedName),
		args: resolvedArgs,
	};
}

/**
 * Normalize common alias param names for blu-insert-inner-block.
 *
 * @param {Object} args
 * @return {Object} The arguments with index/position normalized.
 */
function normalizeInsertInnerBlockArgs(args) {
	if (!args.parent_client_id) {
		args.parent_client_id =
			args.parent_clientId || args.parentClientId || args.client_id || args.clientId;
	}
	if (!args.block_content) {
		const alt = args.content || args.markup || args.html || args.block_markup;
		if (alt) {
			args.block_content = alt;
		}
	}
	// eslint-disable-next-line eqeqeq -- intentional loose check: matches null and undefined
	if (args.index == null && args.position != null) {
		if (typeof args.position === "number") {
			args.index = args.position;
		} else if (args.position === "first") {
			args.index = 0;
		} else if (args.position === "last") {
			args.index = null;
		}
	}
	return args;
}

/**
 * Resolve parent navigation block when inserting a menu link without parent_client_id.
 *
 * @param {Object} args
 * @return {Promise<Object>} The arguments with the parent clientId resolved.
 */
async function resolveInsertInnerBlockArgs(args) {
	normalizeInsertInnerBlockArgs(args);
	if (!args.parent_client_id && args.block_content && /navigation-link/.test(args.block_content)) {
		await hydrateAllRefNavigationBlocks();
		const nav = findHeaderRefNavigationBlock();
		if (nav) {
			args.parent_client_id = nav.clientId;
		}
	}
	return args;
}

/**
 * MCP tools that return data the model must read (not "Applied successfully").
 *
 * @param {string} toolName
 * @return {boolean} True when the tool returns data rather than editing blocks.
 */
function isMcpDataTool(toolName) {
	if (READ_TOOLS.has(toolName)) {
		return true;
	}
	if (/^blu-(pages|posts|media|users|products)-search$/.test(toolName)) {
		return true;
	}
	if (toolName.startsWith("blu-get-") && !BLOCK_TOOL_NAMES.includes(toolName)) {
		return true;
	}
	return false;
}

/**
 * @param {string} text
 * @return {boolean} True when the text is a client-action stub from the MCP server.
 */
function isClientActionStubText(text) {
	try {
		const parsed = JSON.parse(text);
		const payload = parsed?.message && typeof parsed.message === "object" ? parsed.message : parsed;
		return Boolean(payload?.action && CLIENT_ACTION_TOOLS[payload.action]);
	} catch {
		return false;
	}
}

function toolCallUsesBlockMutation(tc) {
	let args = tc.arguments || {};
	if (typeof args === "string") {
		args = safeParseJSON(args).value;
	}
	const { toolName } = resolveClientToolCall(tc.name || "", args);
	return BLOCK_TOOL_NAMES.includes(toolName);
}

/**
 * Parse MCP ability responses that only authorize client-side block execution.
 *
 * @param {Object} mcpResult
 * @return {Object|null} The parsed stub, or null when the result is not one.
 */
function parseMcpClientActionStub(mcpResult) {
	const text = mcpResult?.content?.[0]?.text;
	if (!text) {
		return null;
	}
	try {
		const parsed = JSON.parse(text);
		const payload = parsed?.message && typeof parsed.message === "object" ? parsed.message : parsed;
		if (payload?.action && CLIENT_ACTION_TOOLS[payload.action]) {
			return payload;
		}
	} catch {
		/* not JSON */
	}
	return null;
}

/**
 * Run a block mutation locally when the server returned a client-action stub.
 *
 * @param {Object} stub
 * @param {Object} args     Original tool args (merged with stub fields).
 * @param {Object} toolCall
 * @param {Object} ctx
 * @return {Promise<Object|null>} The tool result, or null when the stub is unsupported.
 */
async function executeClientActionFromStub(stub, args, toolCall, ctx) {
	const merged = { ...args };
	for (const key of [
		"client_id",
		"kind",
		"scope",
		"position",
		"parent_client_id",
		"block_content",
		"label",
		"target_client_id",
		"as_child_of",
		"attributes",
		"before_client_id",
		"after_client_id",
	]) {
		if (stub[key] !== undefined && merged[key] === undefined) {
			merged[key] = stub[key];
		}
	}

	const toolName = CLIENT_ACTION_TOOLS[stub.action];
	if (toolName === "blu-duplicate-block" && (merged.client_id || merged.kind)) {
		return handleDuplicate(toolCall, merged, ctx);
	}
	if (toolName === "blu-delete-block" && (merged.client_id || merged.label)) {
		return handleDeleteBlock(toolCall, merged, ctx);
	}
	if (toolName === "blu-update-block-attrs" && merged.client_id) {
		const attrs = merged.attributes || merged;
		return handleUpdateBlockAttrs(
			toolCall,
			{ client_id: merged.client_id, attributes: attrs, image_prompt: merged.image_prompt },
			ctx
		);
	}
	if (toolName === "blu-insert-inner-block") {
		await resolveInsertInnerBlockArgs(merged);
		if (merged.parent_client_id && merged.block_content) {
			return handleInsertInnerBlock(toolCall, merged, ctx);
		}
	}
	if (
		toolName === "blu-move-block" &&
		merged.client_id &&
		((merged.target_client_id && merged.position) || merged.as_child_of)
	) {
		return handleMoveBlock(toolCall, merged, ctx);
	}
	if (toolName === "blu-edit-block" && merged.client_id && merged.block_content) {
		return handleEditBlock(toolCall, merged, ctx);
	}
	if (toolName === "blu-add-section" && merged.block_content) {
		return handleAddSection(toolCall, merged, ctx);
	}

	return null;
}

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
	"blu-edit-image",
	"blu-regenerate-logo",
	"blu-edit-logo",
	"blu-set-logo-from-image", // write tool, but AI needs the full result (URL) to confirm success
	"blu-read-document",
	"blu-extract-image-colors",
	"blu-generate-color-palette",
	// Gateway tools return data the model needs — pass their full content through.
	// Without these the LLM receives "No changes needed" instead of the ability
	// list/schema, causing it to loop indefinitely without finding the ability.
	"blu-list-abilities",
	"blu-get-ability-schema",
]);

/**
 * Placeholder result for a tool the user stopped before it ran. Every tool_call
 * needs a reply — one without is a hard 400 on the next request.
 *
 * @param {Object} toolCall The tool call that never executed
 * @return {Object} Result entry for the conversation
 */
const cancelledResult = (toolCall) => ({
	tool_call_id: toolCall.id,
	content: "Cancelled: the user stopped this request before the tool ran.",
	isError: true,
});

/**
 * MCP client that refuses to deliver a result once the turn is stopped.
 *
 * Abilities are the slow part of a tool — image generation takes seconds — and
 * handlers write to the editor with whatever comes back. Guarding here rather
 * than in each handler means a stopped turn can't produce an edit, and new
 * tools inherit that without having to remember anything.
 *
 * @param {Object}      mcpClient   The MCP client instance
 * @param {AbortSignal} abortSignal Signal captured when the turn started
 * @return {Object} Client delegating to the original, minus post-stop results
 */
function abortAwareClient(mcpClient, abortSignal) {
	const guarded = Object.create(mcpClient);
	guarded.callTool = async (...args) => {
		const result = await mcpClient.callTool(...args);
		if (abortSignal?.aborted) {
			throw createAbortError();
		}
		return result;
	};
	return guarded;
}

/**
 * Execute tool calls for the function-calling loop.
 *
 * - RETURNS results (for appending to conversation as tool messages)
 * - Executes server-side tools via mcpClient.callTool()
 *
 * @param {Array}  toolCalls Tool calls from the OpenAI streaming response
 * @param {Object} rawCtx    Shared context object with clients, state setters, refs, helpers
 * @return {Promise<Array>}  Array of { tool_call_id, content, isError } for the conversation
 */
export async function executeToolCallsForREST(toolCalls, rawCtx) {
	// Every handler reaches MCP through ctx.mcpClient, so wrapping it once here
	// stops any of them writing to the editor after the user pressed Stop.
	const ctx = {
		...rawCtx,
		mcpClient: abortAwareClient(rawCtx.mcpClient, rawCtx.abortSignal),
	};

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
		if (ctx.abortSignal?.aborted) {
			toolResults.push(cancelledResult(tc));
			continue;
		}

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
	const hasBlockTools = clientToolCalls.some((tc) => toolCallUsesBlockMutation(tc));
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
		if (ctx.abortSignal?.aborted) {
			const remaining = clientToolCalls.slice(i);
			logger.log(`[ToolExecutor:REST] Stopped — cancelling ${remaining.length} pending tool(s)`);
			toolResults.push(...remaining.map(cancelledResult));
			break;
		}

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

			// Unwrap gateway calls and normalize slash/alias ability names.
			({ toolName, args } = resolveClientToolCall(toolName, args));
			toolCall = { ...toolCall, name: toolName };
			if (toolCall.name !== (toolCall.arguments?.ability_name || toolCall.name)) {
				logger.log(`[ToolExecutor:REST] Resolved tool: ${toolName}`, args);
			}

			// Normalize alt param names
			if (!args.client_id && args.clientId) {
				args.client_id = args.clientId;
			}
			if (toolName === "blu-delete-block") {
				if (!args.label && typeof args.item_label === "string") {
					args.label = args.item_label;
				}
				if (!args.label && typeof args.menu_item_label === "string") {
					args.label = args.menu_item_label;
				}
				// Nav menu client_ids go stale after every entity edit — never mix with label.
				if (args.label) {
					delete args.client_id;
					delete args.clientId;
				}
			}
			// The model commonly sends `instruction` (singular) even though the
			// ability schema is `instructions` — accept both.
			if (!args.instructions && args.instruction) {
				args.instructions = args.instruction;
			}
			if (
				(toolName === "blu-edit-block" ||
					toolName === "blu-add-section" ||
					toolName === "blu-insert-inner-block") &&
				!args.block_content
			) {
				const alt = args.content || args.markup || args.html || args.block_markup;
				if (alt) {
					args.block_content = alt;
				}
			}

			if (toolName === "blu-insert-inner-block") {
				await resolveInsertInnerBlockArgs(args);
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
			} else if (toolName === "blu-delete-block" && (args.client_id || args.label)) {
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
						const alt = resolveAlt(args.alt, args.prompt);
						appendGeneratedImageUrl(url, alt);
						if (targetBlock && IMAGE_BLOCKS.has(targetBlock.name)) {
							applyImageToBlock(targetBlock.clientId, url, alt);
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
			} else if (toolName === "blu-edit-image" && args.prompt && args.source_url) {
				await ctx.updateProgress(__("Editing image…", "wp-module-editor-chat"), 500);
				try {
					const mcpResult = await callAbility(ctx.mcpClient, "blu-edit-image", args);
					result = {
						id: toolCall.id,
						result: mcpResult.content,
						isError: mcpResult.isError || false,
					};
					// Track edited image URL so subsequent block updates can reference it
					if (!result.isError && mcpResult.content?.[0]?.text) {
						try {
							const parsed = JSON.parse(mcpResult.content[0].text);
							const url = parsed?.message?.url || parsed?.url;
							if (url) {
								appendGeneratedImageUrl(url);
							}
						} catch {
							/* non-critical */
						}
					}
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
			} else if (toolName === "blu-edit-logo") {
				if (!args.prompt) {
					result = {
						id: toolCall.id,
						result: [
							{
								type: "text",
								text: JSON.stringify({
									error:
										"Missing required parameter: prompt. Describe how to edit the existing logo (colors, text, layout, etc.).",
								}),
							},
						],
						isError: true,
					};
				} else {
					result = await handleEditLogo(toolCall, args, ctx);
					if (!result.isError) {
						hasBlockEdits = true;
					}
				}
			} else if (toolName === "blu-set-logo-from-image" && args.source_url) {
				result = await handleSetLogoFromImage(toolCall, args, ctx);
				if (!result.isError) {
					hasBlockEdits = true;
				}
			} else {
				if (toolName === "blu-add-page") {
					args.meta = {
						nfd_onboarding_generated: "1",
						...(args.meta || {}),
					};
				}

				// Validate Gutenberg markup before entity create/update hits WordPress REST.
				let contentValidationFailed = false;
				if (abilityUsesBlockContent(toolName)) {
					const hasContent =
						args.content || args.block_content || args.markup || args.html || args.block_markup;
					if (hasContent) {
						await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);
						const contentCheck = validateEntityContentArgs(toolName, args);
						if (!contentCheck.ok) {
							contentValidationFailed = true;
							result = {
								id: toolCall.id,
								result: [
									{
										type: "text",
										text: JSON.stringify({
											success: false,
											error: contentCheck.error,
										}),
									},
								],
								isError: true,
							};
						}
					}
				}

				if (!contentValidationFailed) {
					// Server-side MCP tool — forward to MCP server for execution
					logger.log(`[ToolExecutor:REST] Forwarding to MCP: ${toolName}`, args);
					try {
						const mcpResult = await callAbility(ctx.mcpClient, toolName, args);
						const mcpFailed = mcpResultIsError(mcpResult);
						const stub = !mcpFailed ? parseMcpClientActionStub(mcpResult) : null;
						if (stub) {
							const stubResult = await executeClientActionFromStub(stub, args, toolCall, ctx);
							if (stubResult) {
								result = stubResult;
								if (!stubResult.isError && stubResult.hasChanges) {
									hasBlockEdits = true;
								}
							} else {
								result = {
									id: toolCall.id,
									result: mcpResult.content,
									isError: mcpFailed,
								};
							}
						} else {
							result = {
								id: toolCall.id,
								result: mcpResult.content,
								isError: mcpFailed,
							};
						}
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
			}

			// Build tool result for conversation
			const isError = result?.isError ?? false;
			let creationMeta = null;
			let content;
			if (isError) {
				content =
					result.error || result.result?.[0]?.text || __("Tool failed", "wp-module-editor-chat");
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
			} else if (
				result?.result?.[0]?.text &&
				(isMcpDataTool(toolName) ||
					(!result?.hasChanges && !isClientActionStubText(result.result[0].text)))
			) {
				content = result.result[0].text;
			} else {
				// Extract human-readable .message from handler's JSON result
				const msg = (() => {
					try {
						return JSON.parse(result?.result?.[0]?.text)?.message;
					} catch {
						return null;
					}
				})();
				content = result?.hasChanges
					? msg || __("Applied successfully", "wp-module-editor-chat")
					: __("No changes needed", "wp-module-editor-chat");
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
