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
import { EDITOR_SYSTEM_PROMPT, buildEditorContext } from "../utils/editorContext";

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

		const model = options.model || window.nfdEditorChat?.model || "gpt-4o-mini";
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
				max_tokens: options.max_tokens,
			},
			{ signal: controller.signal }
		);

		let fullMessage = "";
		let finishReason = null;
		const toolCallsInProgress = {};

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
				setCurrentResponse((prev) => prev + delta.content);
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

		abortControllerRef.current = null;

		// Parse accumulated tool calls
		const finalToolCalls = Object.values(toolCallsInProgress).map((tc) => ({
			id: tc.id,
			name: tc.function.name,
			arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
		}));

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

			// Build editor context
			const editorContext = buildEditorContext();

			// First message: include system prompt
			if (isFirstMessageRef.current) {
				conversationHistoryRef.current = [{ role: "system", content: EDITOR_SYSTEM_PROMPT }];
				isFirstMessageRef.current = false;
			}

			// Append user message with editor context
			conversationHistoryRef.current.push({
				role: "user",
				content: `<editor_context>\n${editorContext}\n</editor_context>\n\n${messageContent}`,
			});

			// Add clean user message to display
			setMessages((prev) => [
				...prev,
				{
					id: `user-${Date.now()}`,
					role: "user",
					content: messageContent,
					timestamp: new Date(),
				},
			]);

			// Function calling loop
			let iterations = 0;
			try {
				while (iterations++ < MAX_TOOL_ITERATIONS) {
					setStatus(CHAT_STATUS.GENERATING);
					setCurrentResponse("");

					const { content, toolCalls } = await streamCompletion(
						conversationHistoryRef.current,
						openaiTools
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

					// Execute tools
					const results = await executeToolCallsForREST(toolCalls, buildToolCtx());

					// Append tool results to conversation
					for (const r of results) {
						conversationHistoryRef.current.push({
							role: "tool",
							tool_call_id: r.tool_call_id,
							content: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
						});
					}

					setStatus(CHAT_STATUS.SUMMARIZING);
					// Loop continues — next iteration will get the AI's response
				}

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
