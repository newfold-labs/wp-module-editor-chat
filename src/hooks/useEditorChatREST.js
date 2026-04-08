/* eslint-disable no-undef, no-console */
/**
 * useEditorChatREST — Editor chat hook using REST (CF AI Gateway via Worker)
 *
 * Replaces the Jarvis WebSocket-based useEditorChat with a REST-based
 * function-calling loop. Uses OpenAI SDK for streaming, MCP for tool
 * discovery and server-side tool execution.
 */
import { store as coreStore } from "@wordpress/core-data";
import { useDispatch, useSelect } from "@wordpress/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import apiFetch from "@wordpress/api-fetch";
import OpenAI from "openai";

/**
 * External dependencies — from wp-module-ai-chat (utilities only)
 */
import { createMCPClient, archiveConversation } from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import { restoreBlocks, restoreGlobalStyles } from "../services/actionExecutor";
import patternLibrary from "../services/patternLibrary";
import {
	executeToolCallsForREST,
	upsertToolExecMsg,
	resetPatternSearchCache,
} from "../services/toolExecutor";
import { EDITOR_SYSTEM_PROMPT, REASONING_INSTRUCTION, EXECUTE_NUDGE, buildEditorContext } from "../utils/editorContext";
import { safeParseJSON } from "../utils/jsonUtils";

const EDITOR_CHAT_CONSUMER = "editor_chat";
const MAX_TOOL_ITERATIONS = 10;

const CHAT_STATUS = {
	IDLE: "idle",
	GENERATING: "generating",
	TOOL_CALL: "tool_call",
	SUMMARIZING: "summarizing",
	COMPLETED: "completed",
	ERROR: "error",
};

/**
 * Parse the reasoning response to detect [PLAN] prefix.
 * Returns { isPlan, content } where content has the prefix stripped.
 *
 * @param {string} text Raw response text
 * @return {{ isPlan: boolean, content: string }}
 */
function parseReasoningResponse(text) {
	const trimmed = (text || "").trim();
	if (trimmed.startsWith("[PLAN]")) {
		let content = trimmed.slice("[PLAN]".length).trim();

		// The model sometimes hallucinates function calls in the reasoning pass
		// (where tools are disabled).  Truncate at the first sign of tool-call
		// leakage so the user only sees the natural-language plan.
		const junkPatterns = [
			/\bto=functions\./i,
			/\{\s*"client_id"/,
			/\{\s*"block_content"/,
			/<!--\s*wp:/,
			/\{\s*"after_client_id"/,
		];
		for (const pattern of junkPatterns) {
			const match = content.search(pattern);
			if (match !== -1) {
				content = content.slice(0, match).trim();
				break;
			}
		}

		return { isPlan: true, content };
	}
	return { isPlan: false, content: trimmed };
}

/**
 * Truncate tool result content to keep conversation history lean.
 * Preserves enough for the AI to understand what happened.
 *
 * @param {string} content Raw tool result content
 * @param {number} maxLen  Maximum characters to keep
 * @return {string} Possibly truncated content
 */
function truncateToolResult(content, maxLen = 500) {
	if (!content || content.length <= maxLen) {
		return content;
	}
	return content.slice(0, maxLen) + "\n...[truncated]";
}

/**
 * Compress conversation history to reduce token usage on subsequent API calls.
 *
 * Keeps the system prompt and current exchange (from last user message onward)
 * intact. For older messages:
 * - Strips embedded <editor_context> from legacy user messages
 * - Replaces tool_call arguments with compact stubs
 * - Aggressively truncates old tool result content
 *
 * @param {Array} history Conversation history array
 * @return {Array} Compressed history
 */
function compressConversationHistory(history) {
	if (history.length <= 6) {
		return history;
	}

	// Find last user message — everything from there onward is "current"
	let lastUserIdx = -1;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === "user") {
			lastUserIdx = i;
			break;
		}
	}

	if (lastUserIdx <= 1) {
		return history;
	}

	const compressed = [];
	for (let i = 0; i < history.length; i++) {
		const msg = history[i];

		// Keep system prompt (idx 0) and current exchange intact
		if (i === 0 || i >= lastUserIdx) {
			compressed.push(msg);
			continue;
		}

		if (msg.role === "user" && msg.content) {
			// Strip embedded editor context from older user messages
			const stripped = msg.content
				.replace(/<editor_context>[\s\S]*?<\/editor_context>\s*/g, "")
				.trim();
			compressed.push({ ...msg, content: stripped || msg.content });
		} else if (msg.role === "assistant" && msg.tool_calls) {
			// Strip detailed tool_call arguments (keep names for context)
			compressed.push({
				...msg,
				tool_calls: msg.tool_calls.map((tc) => ({
					...tc,
					function: {
						...tc.function,
						arguments: "{}",
					},
				})),
			});
		} else if (msg.role === "tool") {
			// Aggressively truncate older tool results
			compressed.push({
				...msg,
				content: truncateToolResult(msg.content, 150),
			});
		} else {
			compressed.push(msg);
		}
	}

	return compressed;
}

/**
 * Check if conversation has at least one meaningful user message.
 *
 * @param {Array} messages Messages array
 * @return {boolean} True if at least one user message has non-empty content.
 */
function hasMeaningfulUserMessage(messages) {
	return messages.some(
		(m) => (m.role === "user" || m.type === "user") && m.content && String(m.content).trim()
	);
}

/**
 * Convert MCP tools to OpenAI function-calling format.
 *
 * @param {Array} mcpTools Tools from mcpClient.listTools()
 * @return {Array} OpenAI tools array
 */
/**
 * Core block-editing tools. Non-editor tools (posts, media, users, etc.)
 * are only sent to the model when its reasoning plan indicates they're needed.
 */
const EDITOR_TOOLS = new Set([
	"blu-edit-block",
	"blu-add-section",
	"blu-delete-block",
	"blu-move-block",
	"blu-get-block-markup",
	"blu-highlight-block",
	"blu-rewrite-text",
	"blu-update-block-attrs",
	"blu-update-global-styles",
	// blu-generate-image intentionally excluded — image generation is handled
	// internally via image_prompts on blu-add-section (for new sections) and
	// image_prompt on blu-update-block-attrs (for existing images).
	// This prevents the AI from looping on generate-image calls.
]);

/**
 * Check if the user's message requires site management tools.
 * Uses the raw user message (not the AI's plan, which always mentions "page").
 * Matches explicit action + noun patterns to avoid false positives.
 */
function messageNeedsSiteTools(userMessage) {
	const msg = (userMessage || "").toLowerCase();
	return /\b(create|write|publish|draft|make)\b.{0,15}\b(post|article|blog)\b/.test(msg)
		|| /\b(create|make)\b.{0,10}\b(new\s+)?page\b/.test(msg)
		|| /\b(upload|manage)\b.{0,10}\b(media|image|file)\b/.test(msg)
		|| /\b(add|create|manage|update|delete)\b.{0,10}\b(user|product|setting)\b/.test(msg)
		|| /\bwoocommerce\b/.test(msg);
}

function mcpToolsToOpenAI(mcpTools) {
	return mcpTools.map((tool) => ({
		type: "function",
		function: {
			name: (tool.name || "").replace(/\//g, "-"),
			description: tool.description || "",
			parameters: tool.inputSchema || { type: "object", properties: {} },
		},
	}));
}

// Create editor-specific MCP client (for tool discovery + server-side execution)
const mcpClient = createMCPClient({ configKey: "nfdEditorChat" });

/**
 * useEditorChatREST Hook
 *
 * @return {Object} Chat state and handlers for the editor
 */
const useEditorChatREST = () => {
	// ── Config / connection state ──
	const [configStatus, setConfigStatus] = useState("idle"); // idle | loading | ready | error
	const [_mcpStatus, setMcpConnectionStatus] = useState("disconnected");
	const [openaiTools, setOpenaiTools] = useState([]);

	// ── Chat state ──
	const [messages, setMessages] = useState([]);
	const [status, setStatus] = useState(CHAT_STATUS.IDLE);
	const [currentResponse, setCurrentResponse] = useState("");
	const [error, setError] = useState(null);

	// ── Tool execution state ──
	const [activeToolCall, setActiveToolCall] = useState(null);
	const [toolProgress, setToolProgress] = useState(null);
	const [executedTools, setExecutedTools] = useState([]);
	const [pendingTools, setPendingTools] = useState([]);

	// ── Editor state ──
	const [isSaving, setIsSaving] = useState(false);
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);

	// ── Refs ──
	const openaiClientRef = useRef(null);
	const sessionConfigRef = useRef(null);
	const conversationHistoryRef = useRef([]);
	const isFirstMessageRef = useRef(true);
	const hasInitializedRef = useRef(false);
	const originalGlobalStylesRef = useRef(null);
	const blockSnapshotRef = useRef(null);
	const executedToolsRef = useRef([]);
	const messagesRef = useRef(messages);
	const abortControllerRef = useRef(null);

	// Keep messagesRef in sync
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	// WordPress dispatch functions
	const { savePost } = useDispatch("core/editor");
	const { saveEditedEntityRecord } = useDispatch(coreStore);
	const { __experimentalGetCurrentGlobalStylesId } = useSelect(
		(select) => ({
			__experimentalGetCurrentGlobalStylesId:
				select(coreStore).__experimentalGetCurrentGlobalStylesId,
		}),
		[]
	);
	const isSavingPost = useSelect((select) => select("core/editor").isSavingPost(), []);

	// ── Helpers ──
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	// eslint-disable-next-line react-hooks/exhaustive-deps -- stable: only uses state setter and wait
	const updateProgress = useCallback(async (message, minTime = 400) => {
		setToolProgress(message);
		await wait(minTime);
	}, []);

	// ─────────────────────────────────────────────────────────
	// Initialization: config fetch + MCP + pattern library
	// ─────────────────────────────────────────────────────────

	const initialize = useCallback(async () => {
		if (hasInitializedRef.current) {
			return;
		}
		hasInitializedRef.current = true;

		// Fetch config and MCP tools in parallel
		const configPromise = (async () => {
			setConfigStatus("loading");
			try {
				const configUrl = window.nfdEditorChat?.configEndpoint || "";
				if (!configUrl) {
					throw new Error("Config endpoint not configured");
				}

				const config = await apiFetch({ url: configUrl });
				if (!config.session_token || !config.worker_url) {
					throw new Error("Invalid config response");
				}

				sessionConfigRef.current = {
					workerUrl: config.worker_url,
					sessionToken: config.session_token,
					expiresAt: Date.now() + (config.expires_in || 3600) * 1000,
				};

				openaiClientRef.current = new OpenAI({
					apiKey: config.session_token,
					baseURL: config.worker_url,
					dangerouslyAllowBrowser: true,
				});

				setConfigStatus("ready");
			} catch (err) {
				console.error("Failed to fetch editor chat config:", err);
				setConfigStatus("error");
				setError(err.message);
			}
		})();

		const mcpPromise = (async () => {
			try {
				setMcpConnectionStatus("connecting");
				await mcpClient.connect();
				await mcpClient.initialize();
				const availableTools = await mcpClient.listTools();
				setOpenaiTools(mcpToolsToOpenAI(availableTools));
				setMcpConnectionStatus("connected");

				const providerName = window.nfdEditorChat?.patternProvider || "wonderblocks";
				patternLibrary.initialize(providerName).catch(console.warn);
			} catch (err) {
				console.error("Failed to initialize MCP:", err);
				setMcpConnectionStatus("disconnected");
			}
		})();

		await Promise.all([configPromise, mcpPromise]);
	}, []);

	useEffect(() => {
		initialize();
	}, [initialize]);

	// ─────────────────────────────────────────────────────────
	// Session token refresh
	// ─────────────────────────────────────────────────────────

	useEffect(() => {
		const config = sessionConfigRef.current;
		if (!config || !config.expiresAt) {
			return;
		}

		// Refresh at 80% of expiry
		const refreshAt = config.expiresAt - Date.now() - (config.expiresAt - Date.now()) * 0.2;
		if (refreshAt <= 0) {
			return;
		}

		const timer = setTimeout(async () => {
			try {
				const configUrl = window.nfdEditorChat?.configEndpoint || "";
				const newConfig = await apiFetch({ url: configUrl });
				if (newConfig.session_token && newConfig.worker_url) {
					sessionConfigRef.current = {
						workerUrl: newConfig.worker_url,
						sessionToken: newConfig.session_token,
						expiresAt: Date.now() + (newConfig.expires_in || 3600) * 1000,
					};
					openaiClientRef.current = new OpenAI({
						apiKey: newConfig.session_token,
						baseURL: newConfig.worker_url,
						dangerouslyAllowBrowser: true,
					});
					console.log("[EditorChat] Session token refreshed");
				}
			} catch (err) {
				console.error("Failed to refresh session token:", err);
			}
		}, refreshAt);

		return () => clearTimeout(timer);
	}, [configStatus]);

	// ─────────────────────────────────────────────────────────
	// Tool context builder (shared by executeToolCallsForREST)
	// ─────────────────────────────────────────────────────────

	const buildToolCtx = useCallback(
		() => ({
			mcpClient,
			setMessages,
			setStatus,
			setExecutedTools,
			setPendingTools,
			setActiveToolCall,
			setToolProgress,
			setHasGlobalStylesChanges,
			blockSnapshotRef,
			executedToolsRef,
			originalGlobalStylesRef,
			getMessages: () => messagesRef.current,
			updateProgress,
			wait,
		}),
		[updateProgress]
	);

	// ─────────────────────────────────────────────────────────
	// Streaming completion helper
	// ─────────────────────────────────────────────────────────

	/**
	 * Stream a chat completion and accumulate tool calls.
	 * Ported from CloudflareOpenAIClient.createStreamingCompletion.
	 *
	 * @param {Array}  msgs      Messages array for the API
	 * @param {Array}  tools     OpenAI tools array
	 * @param {Object} [options] Extra options (model, temperature, etc.)
	 * @return {Promise<{content: string, toolCalls: Array|null}>}
	 */
	const streamCompletion = useCallback(async (msgs, tools, options = {}) => {
		const client = openaiClientRef.current;
		if (!client) {
			throw new Error("OpenAI client not initialized");
		}

		// Model is controlled by the Worker's DEFAULT_MODEL env var.
		// Only override if explicitly set via wp-config NFD_EDITOR_CHAT_MODEL.
		const model = options.model || window.nfdEditorChat?.model || undefined;
		const controller = new AbortController();
		abortControllerRef.current = controller;

		const stream = await client.chat.completions.create(
			{
				model,
				messages: msgs,
				tools: tools.length > 0 ? tools : undefined,
				tool_choice: tools.length > 0 ? "auto" : undefined,
				stream: true,
				stream_options: { include_usage: true },
				temperature: options.temperature ?? 0.7,
				max_completion_tokens: options.max_completion_tokens,
			},
			{ signal: controller.signal }
		);

		let fullMessage = "";
		let finishReason = null;
		const toolCallsInProgress = {};

		// Prefix stripping: buffer early chars to hide [PLAN] from the UI
		const stripPrefix = options.stripPrefix || null;
		let prefixBuffer = "";
		let prefixResolved = !stripPrefix; // skip buffering if no prefix to strip

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta;
			if (!delta) {
				// Usage-only chunk or empty
				if (chunk.usage) {
					console.log(
						`[Token Usage] prompt: ${chunk.usage.prompt_tokens} | completion: ${chunk.usage.completion_tokens} | total: ${chunk.usage.total_tokens}`
					);
				}
				continue;
			}

			// Text content
			if (delta.content) {
				fullMessage += delta.content;

				// Silent mode: accumulate content but don't stream to UI
				if (options.silent) {
					continue;
				}

				if (!prefixResolved) {
					prefixBuffer += delta.content;
					if (prefixBuffer.length >= stripPrefix.length) {
						prefixResolved = true;
						if (prefixBuffer.startsWith(stripPrefix)) {
							// Strip prefix, stream the remainder
							const remainder = prefixBuffer.slice(stripPrefix.length);
							if (remainder) {
								setCurrentResponse((prev) => prev + remainder);
							}
						} else {
							// Not a match, flush entire buffer
							setCurrentResponse((prev) => prev + prefixBuffer);
						}
					}
					// Still buffering — don't update UI yet
				} else {
					setCurrentResponse((prev) => prev + delta.content);
				}
			}

			// Tool call deltas
			if (delta.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					const index = toolCall.index;
					if (!toolCallsInProgress[index]) {
						toolCallsInProgress[index] = {
							id: toolCall.id || "",
							type: "function",
							function: {
								name: toolCall.function?.name || "",
								arguments: "",
							},
						};
					}
					if (toolCall.id) {
						toolCallsInProgress[index].id = toolCall.id;
					}
					if (toolCall.function?.name) {
						toolCallsInProgress[index].function.name = toolCall.function.name;
					}
					if (toolCall.function?.arguments) {
						toolCallsInProgress[index].function.arguments += toolCall.function.arguments;
					}
				}
			}

			if (chunk.choices?.[0]?.finish_reason) {
				finishReason = chunk.choices[0].finish_reason;
			}
		}

		// Flush any unresolved prefix buffer (response shorter than prefix length)
		if (!prefixResolved && prefixBuffer) {
			setCurrentResponse((prev) => prev + prefixBuffer);
		}

		abortControllerRef.current = null;

		// Parse accumulated tool calls (with recovery for truncated JSON)
		const finalToolCalls = Object.values(toolCallsInProgress).map((tc) => {
			if (!tc.function.arguments) {
				return { id: tc.id, name: tc.function.name, arguments: {} };
			}
			const { value, recovered } = safeParseJSON(tc.function.arguments);
			const isTruncated = recovered && Object.keys(value).length === 0;
			return {
				id: tc.id,
				name: tc.function.name,
				arguments: value,
				_truncated: isTruncated,
			};
		});

		return {
			content: fullMessage,
			toolCalls: finalToolCalls.length > 0 ? finalToolCalls : null,
			finishReason,
		};
	}, []);

	// ─────────────────────────────────────────────────────────
	// Display messages (ported from useEditorChat displayMessages)
	// ─────────────────────────────────────────────────────────

	const displayMessages = useMemo(() => {
		let msgs = [...messages];

		// Hold back final assistant response while tools are executing
		const isToolsActive = !!activeToolCall || pendingTools.length > 0;
		if (isToolsActive && msgs.length > 0) {
			const last = msgs[msgs.length - 1];
			const isFinalResponse =
				(last.role === "assistant" || last.type === "assistant") &&
				!last.id?.includes("-reasoning") &&
				last.type !== "tool_execution";
			if (isFinalResponse) {
				msgs = msgs.slice(0, -1);
			}
		}

		// Amend final assistant message with tool failure notices
		if (!isToolsActive) {
			const failedTools = msgs
				.filter((m) => m.type === "tool_execution")
				.flatMap((m) => (m.executedTools || []).filter((t) => t.isError));
			if (failedTools.length > 0) {
				for (let i = msgs.length - 1; i >= 0; i--) {
					const m = msgs[i];
					if (
						(m.role === "assistant" || m.type === "assistant") &&
						m.type !== "tool_execution" &&
						!m.id?.includes("-reasoning") &&
						m.content
					) {
						const names = failedTools.map((t) => (t.name || "unknown").replace(/^blu-/, ""));
						const notice =
							failedTools.length === 1
								? `\n\n> **Note:** The **${names[0]}** action failed and was not applied.`
								: `\n\n> **Note:** The following actions failed and were not applied: **${names.join("**, **")}**.`;
						msgs = [
							...msgs.slice(0, i),
							{ ...m, content: m.content + notice },
							...msgs.slice(i + 1),
						];
						break;
					}
				}
			}
		}

		// Merge consecutive tool_execution messages
		const merged = [];
		for (const msg of msgs) {
			const prev = merged[merged.length - 1];
			if (msg.type === "tool_execution" && prev?.type === "tool_execution") {
				merged[merged.length - 1] = {
					...prev,
					executedTools: [...(prev.executedTools || []), ...(msg.executedTools || [])],
					...(msg.hasActions ? { hasActions: true, undoData: msg.undoData } : {}),
				};
			} else {
				merged.push(msg);
			}
		}
		msgs = merged;

		// Augment tool_execution with live state
		const hasToolActivity = !!activeToolCall || pendingTools.length > 0 || executedTools.length > 0;
		if (hasToolActivity) {
			let lastUserIdx = -1;
			for (let i = msgs.length - 1; i >= 0; i--) {
				if (msgs[i].role === "user") {
					lastUserIdx = i;
					break;
				}
			}
			let toolExecIdx = -1;
			for (let i = msgs.length - 1; i > lastUserIdx; i--) {
				if (msgs[i].type === "tool_execution") {
					toolExecIdx = i;
					break;
				}
			}

			const msgTools = toolExecIdx !== -1 ? msgs[toolExecIdx].executedTools || [] : [];
			const stateIds = new Set(executedTools.map((t) => t.id));
			const allExecuted = [...msgTools.filter((t) => !stateIds.has(t.id)), ...executedTools];

			const augmented = {
				id: toolExecIdx !== -1 ? msgs[toolExecIdx].id : "tool-exec-live",
				role: "assistant",
				type: "tool_execution",
				executedTools: allExecuted,
				activeToolCall,
				pendingTools,
				toolProgress,
				...(toolExecIdx !== -1 && msgs[toolExecIdx].hasActions
					? { hasActions: true, undoData: msgs[toolExecIdx].undoData }
					: {}),
				timestamp: toolExecIdx !== -1 ? msgs[toolExecIdx].timestamp : new Date(),
			};

			if (toolExecIdx !== -1) {
				msgs = [...msgs.slice(0, toolExecIdx), augmented, ...msgs.slice(toolExecIdx + 1)];
			} else {
				let insertIdx = msgs.length;
				for (let i = msgs.length - 1; i >= 0; i--) {
					if (msgs[i].role === "user") {
						insertIdx = i + 1;
						break;
					}
				}
				msgs = [...msgs.slice(0, insertIdx), augmented, ...msgs.slice(insertIdx)];
			}
		}

		// Streaming text overlay
		if (currentResponse) {
			return [
				...msgs,
				{
					id: "streaming-current",
					type: "assistant",
					role: "assistant",
					content: currentResponse,
				},
			];
		}

		return msgs;
	}, [messages, currentResponse, activeToolCall, pendingTools, executedTools, toolProgress]);

	// ─────────────────────────────────────────────────────────
	// Derived state
	// ─────────────────────────────────────────────────────────

	const isLoading =
		status === CHAT_STATUS.GENERATING ||
		status === CHAT_STATUS.TOOL_CALL ||
		status === CHAT_STATUS.SUMMARIZING ||
		configStatus === "loading";

	// ─────────────────────────────────────────────────────────
	// Keep executedTools ref in sync
	// ─────────────────────────────────────────────────────────

	useEffect(() => {
		if (executedTools.length > 0) {
			executedToolsRef.current = executedTools;
		}
	}, [executedTools]);

	// Clear executed tools when idle
	useEffect(() => {
		if (status === CHAT_STATUS.IDLE && executedTools.length > 0) {
			upsertToolExecMsg(setMessages, executedTools);
			executedToolsRef.current = [...executedTools];
			setExecutedTools([]);
		}
	}, [status, executedTools]);

	// Watch for save completion
	useEffect(() => {
		if (isSaving && !isSavingPost) {
			setMessages((prev) =>
				prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions: _hasActions, undoData: _undoData, ...rest } = msg;
						return rest;
					}
					return msg;
				})
			);
			setHasGlobalStylesChanges(false);
			setIsSaving(false);
		}
	}, [isSaving, isSavingPost]);

	// Archive conversation while chatting and on unload
	useEffect(() => {
		if (hasMeaningfulUserMessage(messages)) {
			archiveConversation(messages, null, null, EDITOR_CHAT_CONSUMER);
		}
	}, [messages]);

	useEffect(() => {
		const handleBeforeUnload = () => {
			if (hasMeaningfulUserMessage(messagesRef.current)) {
				archiveConversation(messagesRef.current, null, null, EDITOR_CHAT_CONSUMER);
			}
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, []);

	// ─────────────────────────────────────────────────────────
	// handleSendMessage — function calling loop
	// ─────────────────────────────────────────────────────────

	const handleSendMessage = useCallback(
		async (messageContent) => {
			if (!openaiClientRef.current || configStatus !== "ready") {
				setError("Chat is not ready. Please wait for initialization.");
				return;
			}

			// Reset state
			setExecutedTools([]);
			executedToolsRef.current = [];
			setPendingTools([]);
			setActiveToolCall(null);
			setToolProgress(null);
			setCurrentResponse("");
			setError(null);
			resetPatternSearchCache();

			// First message: include system prompt
			if (isFirstMessageRef.current) {
				conversationHistoryRef.current = [{ role: "system", content: EDITOR_SYSTEM_PROMPT }];
				isFirstMessageRef.current = false;
			}

			// Store clean user message — editor context is injected per-request, not persisted
			conversationHistoryRef.current.push({
				role: "user",
				content: messageContent,
			});

			// Add clean user message to display
			setMessages((prev) => [
				...prev,
				{
					id: `user-${Date.now()}`,
					type: "user",
					role: "user",
					content: messageContent,
					timestamp: new Date(),
				},
			]);

			// Function calling loop with reasoning first-pass
			let iterations = 0;
			let isReasoningPass = true;
			const currentUserMessage = messageContent; // used to select tools for pass 2
			const toolNameCounts = new Map(); // per-name counter across iterations (counts iterations, not individual calls)
			const MAX_SAME_TOOL_RETRIES = 1; // block on 2nd iteration of the same write tool
			let retryLimitHit = false; // true after first retry detection — break on second
			const READ_ONLY_TOOLS = new Set([
				"blu-get-block-markup", "blu-get-global-styles", "blu-get-active-global-styles",
				"blu-search-patterns", "blu-highlight-block", "blu-generate-image",
			]);
			try {
				while (iterations++ < MAX_TOOL_ITERATIONS) {
					// Fresh editor context each iteration (reflects tool changes)
					const editorContext = buildEditorContext();
					const editorContextMsg = {
						role: "system",
						content: `<editor_context>\n${editorContext}\n</editor_context>`,
					};

					setStatus(CHAT_STATUS.GENERATING);
					setCurrentResponse("");

					if (isReasoningPass) {
						// ── Pass 1: reasoning call — no tools, [PLAN] prefix stripped ──
						isReasoningPass = false;

						const reasoningMessages = [
							...conversationHistoryRef.current,
							editorContextMsg,
							{ role: "system", content: REASONING_INSTRUCTION },
						];

						const { content: rawReasoning } = await streamCompletion(
							reasoningMessages,
							[],
							{ max_completion_tokens: 200, stripPrefix: "[PLAN]" }
						);

						const { isPlan, content: reasoning } = parseReasoningResponse(rawReasoning);

						if (!isPlan) {
							// Conversational response — final answer, no tools needed
							conversationHistoryRef.current.push({
								role: "assistant",
								content: reasoning,
							});
							setCurrentResponse("");
							setMessages((prev) => [
								...prev,
								{
									id: `assistant-${Date.now()}`,
									type: "assistant",
									role: "assistant",
									content: reasoning,
									timestamp: new Date(),
								},
							]);
							break;
						}

						// It's a plan — persist reasoning as a visible message
						conversationHistoryRef.current.push({
							role: "assistant",
							content: reasoning,
						});
						setCurrentResponse("");
						setMessages((prev) => [
							...prev,
							{
								id: `assistant-${Date.now()}-reasoning`,
								type: "assistant",
								role: "assistant",
								content: reasoning,
								timestamp: new Date(),
							},
						]);

						// Continue to next iteration which will call with tools
						continue;
					}

					// ── Pass 2+: call with tools ──
					// Dynamically select tools based on the user's message:
					// editor tasks → only block-editing tools (prevents search-media, get-function-details, etc.)
					// site management tasks (create post, upload media, etc.) → all tools
					const toolsForPass = messageNeedsSiteTools(currentUserMessage)
						? openaiTools
						: openaiTools.filter((t) => EDITOR_TOOLS.has(t.function.name));

					// Editor context + execute nudge injected per-request, NOT persisted
					const toolMessages = [
						...conversationHistoryRef.current,
						editorContextMsg,
						{ role: "system", content: EXECUTE_NUDGE },
					];

					const { content, toolCalls } = await streamCompletion(
						toolMessages,
						toolsForPass,
						{ silent: true }
					);

					if (!toolCalls || toolCalls.length === 0) {
						// Final response — no more tools
						conversationHistoryRef.current.push({
							role: "assistant",
							content,
						});
						setCurrentResponse("");
						setMessages((prev) => [
							...prev,
							{
								id: `assistant-${Date.now()}`,
								type: "assistant",
								role: "assistant",
								content,
								timestamp: new Date(),
							},
						]);
						break;
					}

					// Tool calls — execute them
					setCurrentResponse("");
					setStatus(CHAT_STATUS.TOOL_CALL);

					// Retry detection: count iterations per tool name (not individual calls)
					// Skip read-only tools — reading blocks is a prerequisite for editing
					const writeToolsInBatch = new Set();
					for (const tc of toolCalls) {
						if (!READ_ONLY_TOOLS.has(tc.name)) {
							writeToolsInBatch.add(tc.name);
						}
					}
					for (const name of writeToolsInBatch) {
						toolNameCounts.set(name, (toolNameCounts.get(name) || 0) + 1);
					}
					const allRetried = writeToolsInBatch.size > 0 && [...writeToolsInBatch].every(
						(name) => toolNameCounts.get(name) > MAX_SAME_TOOL_RETRIES
					);

					if (allRetried) {
						// Second trigger → stop immediately
						if (retryLimitHit) {
							console.warn("[EditorChat] Retry loop — breaking (AI ignored RETRY LIMIT)");
							break;
						}
						retryLimitHit = true;
						console.warn(
							"[EditorChat] Retry loop detected — all tool calls have been repeated",
							toolCalls.map((tc) => `${tc.name} (${toolNameCounts.get(tc.name)}x)`)
						);
						// Append the assistant message so the conversation stays valid
						conversationHistoryRef.current.push({
							role: "assistant",
							content: content || null,
							tool_calls: toolCalls.map((tc) => ({
								id: tc.id,
								type: "function",
								function: {
									name: tc.name,
									arguments:
										typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
								},
							})),
						});
						// Inject synthetic tool results — give AI one chance to summarize
						for (const tc of toolCalls) {
							conversationHistoryRef.current.push({
								role: "tool",
								tool_call_id: tc.id,
								content: "RETRY LIMIT: This tool has already been called multiple times. The edit is already applied. Do NOT call any more tools — respond to the user with a brief summary.",
							});
						}
						continue;
					}

					// Append assistant message with tool_calls to conversation
					conversationHistoryRef.current.push({
						role: "assistant",
						content: content || null,
						tool_calls: toolCalls.map((tc) => ({
							id: tc.id,
							type: "function",
							function: {
								name: tc.name,
								arguments:
									typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
							},
						})),
					});

					// Handle truncated tool calls — skip execution, return error
					const truncated = toolCalls.filter((tc) => tc._truncated);
					if (truncated.length > 0) {
						for (const tc of truncated) {
							conversationHistoryRef.current.push({
								role: "tool",
								tool_call_id: tc.id,
								content: "ERROR: Tool arguments were truncated and could not be parsed. Try again with shorter content or fewer changes at once.",
							});
						}
					}

					// Execute non-truncated tools only
					const executableCalls = toolCalls.filter((tc) => !tc._truncated);
					const results = executableCalls.length > 0
						? await executeToolCallsForREST(executableCalls, buildToolCtx())
						: [];

					// Append tool results to conversation (truncated to limit token growth)
					for (const r of results) {
						const rawContent = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
						conversationHistoryRef.current.push({
							role: "tool",
							tool_call_id: r.tool_call_id,
							content: truncateToolResult(rawContent),
						});
					}

					// If all tools succeeded, nudge the AI to summarize rather than retry.
					// The AI can still chain different tools if needed (e.g., generate-image
					// then update-block-attrs) — it just shouldn't repeat the same operation.
					const allSucceeded = results.every((r) => !r.isError);
					if (allSucceeded && results.length > 0) {
						conversationHistoryRef.current.push({
							role: "system",
							content: "All actions completed successfully. If the user's request is fully handled, respond with a brief summary. Only call more tools if additional DIFFERENT steps are needed to complete the request.",
						});
					}

					setStatus(CHAT_STATUS.SUMMARIZING);
					// Loop continues — next iteration will get the AI's response
				}

				// Compress older exchanges to keep history lean for next turn
				conversationHistoryRef.current = compressConversationHistory(
					conversationHistoryRef.current
				);

				setStatus(CHAT_STATUS.COMPLETED);
				// After a brief pause, return to idle
				setTimeout(() => setStatus(CHAT_STATUS.IDLE), 500);
			} catch (err) {
				if (err.name === "AbortError") {
					console.log("[EditorChat] Request aborted");
					setStatus(CHAT_STATUS.IDLE);
					return;
				}
				console.error("[EditorChat] Error in chat loop:", err);
				setError(err.message);
				setStatus(CHAT_STATUS.ERROR);
				setMessages((prev) => [
					...prev,
					{
						id: `error-${Date.now()}`,
						type: "assistant",
						role: "assistant",
						content: __("Something went wrong. Please try again.", "wp-module-editor-chat"),
						timestamp: new Date(),
					},
				]);
			} finally {
				setCurrentResponse("");
				setActiveToolCall(null);
				setToolProgress(null);
				setPendingTools([]);
			}
		},
		[configStatus, openaiTools, streamCompletion, buildToolCtx]
	);

	// ─────────────────────────────────────────────────────────
	// handleNewChat
	// ─────────────────────────────────────────────────────────

	const handleNewChat = useCallback(() => {
		// Archive outgoing conversation
		archiveConversation(messagesRef.current, null, null, EDITOR_CHAT_CONSUMER);

		// Reset everything
		setMessages([]);
		conversationHistoryRef.current = [];
		isFirstMessageRef.current = true;
		setHasGlobalStylesChanges(false);
		setExecutedTools([]);
		executedToolsRef.current = [];
		setPendingTools([]);
		setActiveToolCall(null);
		setToolProgress(null);
		setCurrentResponse("");
		setError(null);
		setStatus(CHAT_STATUS.IDLE);
		originalGlobalStylesRef.current = null;
		blockSnapshotRef.current = null;
	}, []);

	// ─────────────────────────────────────────────────────────
	// handleStopRequest
	// ─────────────────────────────────────────────────────────

	const handleStopRequest = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setActiveToolCall(null);
		setToolProgress(null);
		setPendingTools([]);
		setCurrentResponse("");
		setStatus(CHAT_STATUS.IDLE);
	}, []);

	// ─────────────────────────────────────────────────────────
	// Accept / Decline changes (ported from useEditorChat)
	// ─────────────────────────────────────────────────────────

	// eslint-disable-next-line no-unused-vars -- wired up via ChatMessages action buttons
	const handleAcceptChanges = useCallback(async () => {
		setIsSaving(true);

		if (hasGlobalStylesChanges) {
			try {
				const globalStylesId = __experimentalGetCurrentGlobalStylesId
					? __experimentalGetCurrentGlobalStylesId()
					: undefined;
				if (globalStylesId) {
					await saveEditedEntityRecord("root", "globalStyles", globalStylesId);
				}
				originalGlobalStylesRef.current = null;
			} catch (saveError) {
				console.error("Error saving global styles:", saveError);
			}
		}

		// Save dirty template-part entities
		try {
			const coreSelect = wp.data.select("core");
			const getDirtyRecords =
				coreSelect.__experimentalGetDirtyEntityRecords || coreSelect.getDirtyEntityRecords;
			if (getDirtyRecords) {
				const allDirty = getDirtyRecords();
				const dirtyTemplateParts = allDirty.filter(
					(r) => r.kind === "postType" && r.name === "wp_template_part"
				);
				for (const record of dirtyTemplateParts) {
					await saveEditedEntityRecord("postType", "wp_template_part", record.key);
				}
			}
		} catch (tpError) {
			console.error("[TP-SAVE] Error saving template parts:", tpError);
		}

		blockSnapshotRef.current = null;

		// Notify the AI that changes were accepted
		setMessages((prev) => [
			...prev,
			{
				id: `notification-${Date.now()}`,
				type: "notification",
				content: "The user accepted and saved all the changes you made.",
			},
		]);

		if (savePost) {
			savePost();
		}
	}, [
		hasGlobalStylesChanges,
		__experimentalGetCurrentGlobalStylesId,
		saveEditedEntityRecord,
		savePost,
	]);

	// eslint-disable-next-line no-unused-vars -- wired up via ChatMessages action buttons
	const handleDeclineChanges = useCallback(async () => {
		const firstActionMessage = messages.find((msg) => msg.hasActions && msg.undoData);

		if (!firstActionMessage || !firstActionMessage.undoData) {
			console.error("No undo data available");
			return;
		}

		try {
			const undoData = firstActionMessage.undoData;

			if (undoData && typeof undoData === "object" && !Array.isArray(undoData)) {
				if (undoData.blocks && Array.isArray(undoData.blocks) && undoData.blocks.length > 0) {
					const { dispatch: wpDispatch } = wp.data;
					const { createBlock: wpCreateBlock } = wp.blocks;

					const restoreBlock = (parsed) => {
						const innerBlocks = parsed.innerBlocks
							? parsed.innerBlocks.map((inner) => restoreBlock(inner))
							: [];
						return wpCreateBlock(parsed.name, parsed.attributes || {}, innerBlocks);
					};
					const restoredBlocks = undoData.blocks.map((b) => restoreBlock(b));
					wpDispatch("core/block-editor").resetBlocks(restoredBlocks);
				}
				if (
					undoData.globalStyles &&
					undoData.globalStyles.originalStyles &&
					undoData.globalStyles.globalStylesId
				) {
					await restoreGlobalStyles(undoData.globalStyles);
				}
			} else if (Array.isArray(undoData)) {
				await restoreBlocks(undoData);
			}

			setMessages((prev) => [
				...prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions: _hasActions, undoData: _msgUndoData, ...rest } = msg;
						return rest;
					}
					return msg;
				}),
				{
					id: `notification-${Date.now()}`,
					type: "notification",
					content:
						"The user declined the changes. All modifications have been reverted to their previous state.",
				},
			]);

			setHasGlobalStylesChanges(false);
			originalGlobalStylesRef.current = null;
			blockSnapshotRef.current = null;
		} catch (restoreError) {
			console.error("Error restoring changes:", restoreError);
		}
	}, [messages]);

	// ─────────────────────────────────────────────────────────
	// Return interface (same shape as useEditorChat)
	// ─────────────────────────────────────────────────────────

	return {
		messages: displayMessages,
		isLoading,
		error,
		status,
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		handleSendMessage,
		handleNewChat,
		handleStopRequest,
	};
};

export default useEditorChatREST;
