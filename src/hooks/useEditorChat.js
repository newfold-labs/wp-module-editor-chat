/* eslint-disable no-undef, no-console */
/**
 * WordPress dependencies
 */
import { store as coreStore } from "@wordpress/core-data";
import { useDispatch, useSelect } from "@wordpress/data";
import { useCallback, useEffect, useMemo, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies - from wp-module-ai-chat
 */
import {
	CHAT_STATUS,
	createMCPClient,
	useNfdAgentsWebSocket,
	archiveConversation,
	hasMeaningfulUserMessage,
} from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import { restoreBlocks, restoreGlobalStyles } from "../services/actionExecutor";
import patternLibrary from "../services/patternLibrary";
import { executeToolCallsFromWebSocket } from "../services/toolExecutor";
import { EDITOR_SYSTEM_PROMPT, buildEditorContext } from "../utils/editorContext";

const EDITOR_CHAT_CONSUMER = "editor_chat";

// Create editor-specific MCP client (still used for tool discovery and fallback execution)
const mcpClient = createMCPClient({ configKey: "nfdEditorChat" });

/**
 * useEditorChat Hook
 *
 * Editor-specific chat hook that uses the Jarvis WebSocket gateway
 * (via useNfdAgentsWebSocket) and adds editor-specific functionality
 * like accept/decline, tool execution for block editing, and real-time
 * visual updates for global styles.
 *
 * @return {Object} Chat state and handlers for the editor
 */
const useEditorChat = () => {
	// Editor-specific state (not managed by WebSocket hook)
	const [isSaving, setIsSaving] = useState(false);
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);
	const [mcpConnectionStatus, setMcpConnectionStatus] = useState("disconnected");
	const [tools, setTools] = useState([]);
	const [activeToolCall, setActiveToolCall] = useState(null);
	const [toolProgress, setToolProgress] = useState(null);
	const [executedTools, setExecutedTools] = useState([]);
	const [pendingTools, setPendingTools] = useState([]);
	const [localStatusOverride, setLocalStatusOverride] = useState(null);

	const hasInitializedRef = useRef(false);
	const isFirstMessageRef = useRef(true);
	const originalGlobalStylesRef = useRef(null);
	const blockSnapshotRef = useRef(null);
	const executedToolsRef = useRef([]);

	// Get WordPress editor dispatch functions
	const { savePost } = useDispatch("core/editor");
	const { saveEditedEntityRecord } = useDispatch(coreStore);
	const { __experimentalGetCurrentGlobalStylesId } = useSelect(
		(select) => ({
			__experimentalGetCurrentGlobalStylesId:
				select(coreStore).__experimentalGetCurrentGlobalStylesId,
		}),
		[]
	);

	// Get WordPress save status
	const isSavingPost = useSelect((select) => select("core/editor").isSavingPost(), []);

	/**
	 * Helper to wait for a minimum time
	 *
	 * @param {number} ms Milliseconds to wait
	 * @return {Promise} Promise that resolves after ms
	 */
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	/**
	 * Update progress with minimum display time
	 *
	 * @param {string} message Progress message to show
	 * @param {number} minTime Minimum time to display
	 */
	const updateProgress = async (message, minTime = 400) => {
		setToolProgress(message);
		await wait(minTime);
	};

	// ───────────────────────────────────────────────────────────
	// WebSocket hook — manages connection, messages, streaming
	// ───────────────────────────────────────────────────────────
	const configEndpoint = window.nfdEditorChat?.agentsConfigUrl || "";

	// Use a ref for the tool call handler so the WebSocket hook always
	// sees the latest version (the hook stores onToolCall in a ref internally).
	const handleToolCallRef = useRef(null);

	const {
		messages: wsMessages,
		setMessages: wsSetMessages,
		isConnecting,
		error: wsError,
		isTyping,
		status: wsStatus,
		currentResponse,
		connectionState,
		sendMessage: wsSendMessage,
		stopRequest: wsStopRequest,
		sendToolResult: wsSendToolResult,
		clearChatHistory: wsClearChatHistory,
		getSessionId,
		connect: wsConnect,
	} = useNfdAgentsWebSocket({
		configEndpoint,
		consumer: EDITOR_CHAT_CONSUMER,
		consumerType: "editor_chat",
		autoConnect: true,
		autoLoadHistory: true,
		onToolCall: (...args) => handleToolCallRef.current?.(...args),
		getConnectionFailedFallbackMessage: () =>
			__(
				"I couldn't connect to the server. Please try again in a moment.",
				"wp-module-editor-chat"
			),
	});

	// Keep a ref to messages for callbacks
	const wsMessagesRef = useRef(wsMessages);
	useEffect(() => {
		wsMessagesRef.current = wsMessages;
	}, [wsMessages]);

	/**
	 * Build the shared context object passed to executeToolCallsFromWebSocket.
	 */
	const buildToolCtx = useCallback(
		() => ({
			mcpClient,
			setMessages: wsSetMessages,
			setStatus: setLocalStatusOverride,
			setExecutedTools,
			setPendingTools,
			setActiveToolCall,
			setToolProgress,
			setHasGlobalStylesChanges,
			blockSnapshotRef,
			executedToolsRef,
			originalGlobalStylesRef,
			getMessages: () => wsMessagesRef.current,
			updateProgress,
			wait,
			sendToolResult: (resultJson) =>
				wsSendToolResult?.("batch", "batch", resultJson),
		}),
		[wsSetMessages, wsSendToolResult]
	);

	/**
	 * Handle tool_call events from the WebSocket gateway.
	 * Executes tools client-side for visual updates.
	 */
	const handleToolCall = useCallback(
		(toolCalls) => {
			executeToolCallsFromWebSocket(toolCalls, buildToolCtx());
		},
		[buildToolCtx]
	);

	// Keep the ref in sync so the WebSocket hook always calls the latest handler
	useEffect(() => {
		handleToolCallRef.current = handleToolCall;
	}, [handleToolCall]);

	// ───────────────────────────────────────────────────────────
	// Derived status
	// ───────────────────────────────────────────────────────────
	const effectiveStatus = useMemo(() => {
		if (activeToolCall) {
			return CHAT_STATUS.TOOL_CALL;
		}
		if (localStatusOverride) {
			return localStatusOverride;
		}
		if (isTyping && executedToolsRef.current.length > 0) {
			return CHAT_STATUS.SUMMARIZING;
		}
		if (isTyping) {
			return CHAT_STATUS.GENERATING;
		}
		return wsStatus;
	}, [activeToolCall, localStatusOverride, isTyping, wsStatus]);

	// Clear local status override when typing finishes
	useEffect(() => {
		if (!isTyping && !activeToolCall) {
			setLocalStatusOverride(null);
		}
	}, [isTyping, activeToolCall]);

	// ───────────────────────────────────────────────────────────
	// Display messages: wsMessages + synthetic streaming message
	// ───────────────────────────────────────────────────────────
	const displayMessages = useMemo(() => {
		if (!currentResponse) {
			return wsMessages;
		}
		return [
			...wsMessages,
			{
				id: "streaming-current",
				type: "assistant",
				role: "assistant",
				content: currentResponse,
				isStreaming: true,
			},
		];
	}, [wsMessages, currentResponse]);

	// ───────────────────────────────────────────────────────────
	// Derived state
	// ───────────────────────────────────────────────────────────
	const isLoading = isTyping || isConnecting || !!activeToolCall;
	const sessionId = getSessionId();
	const error = wsError;

	// ───────────────────────────────────────────────────────────
	// MCP initialization (for tool discovery and pattern library)
	// ───────────────────────────────────────────────────────────
	const initializeMCP = useCallback(async () => {
		if (mcpConnectionStatus === "connecting" || mcpConnectionStatus === "connected") {
			return;
		}

		try {
			setMcpConnectionStatus("connecting");
			await mcpClient.connect();
			await mcpClient.initialize();
			const availableTools = await mcpClient.listTools();
			setTools(availableTools);
			setMcpConnectionStatus("connected");

			// Fire and forget — index loads in background
			const providerName = window.nfdEditorChat?.patternProvider || "wonderblocks";
			patternLibrary.initialize(providerName).catch(console.warn);
		} catch (err) {
			console.error("Failed to initialize MCP:", err);
			setMcpConnectionStatus("disconnected");
		}
	}, [mcpConnectionStatus]);

	// Initialize on mount
	useEffect(() => {
		if (hasInitializedRef.current) {
			return;
		}
		hasInitializedRef.current = true;
		initializeMCP();
	}, [initializeMCP]);

	// Watch for save completion
	useEffect(() => {
		if (isSaving && !isSavingPost) {
			wsSetMessages((prev) =>
				prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions, undoData, ...rest } = msg;
						return rest;
					}
					return msg;
				})
			);
			setHasGlobalStylesChanges(false);
			setIsSaving(false);
		}
	}, [isSaving, isSavingPost, wsSetMessages]);

	// Keep ref in sync during tool execution; skip clearing so ref
	// persists for SUMMARIZING status after state is cleared
	useEffect(() => {
		if (executedTools.length > 0) {
			executedToolsRef.current = executedTools;
		}
	}, [executedTools]);

	// Archive conversation while chatting and before page unload
	useEffect(() => {
		if (hasMeaningfulUserMessage(wsMessages)) {
			archiveConversation(wsMessages, getSessionId(), null, EDITOR_CHAT_CONSUMER);
		}
	}, [wsMessages, getSessionId]);

	useEffect(() => {
		const handleBeforeUnload = () => {
			if (hasMeaningfulUserMessage(wsMessagesRef.current)) {
				archiveConversation(wsMessagesRef.current, getSessionId(), null, EDITOR_CHAT_CONSUMER);
			}
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [getSessionId]);

	// Reset isFirstMessageRef on WebSocket reconnection so the next
	// message includes the system prompt and editor context. Without
	// this, a reconnection mid-conversation would send messages without
	// <system_instructions>, causing the backend to fall back to a
	// generic (non-editor) greeting.
	const prevConnectionState = useRef(connectionState);
	useEffect(() => {
		const wasDisconnected =
			prevConnectionState.current === "reconnecting" ||
			prevConnectionState.current === "disconnected" ||
			prevConnectionState.current === "failed";
		if (connectionState === "connected" && wasDisconnected && wsMessages.length > 0) {
			isFirstMessageRef.current = true;
		}
		prevConnectionState.current = connectionState;
	}, [connectionState, wsMessages.length]);

	// Remove duplicate consecutive error messages (the WS hook may add
	// a fallback from both its connectionState watcher and sendMessage)
	useEffect(() => {
		if (wsMessages.length >= 2) {
			const last = wsMessages[wsMessages.length - 1];
			const prev = wsMessages[wsMessages.length - 2];
			if (last.role === "assistant" && prev.role === "assistant" && last.content === prev.content) {
				wsSetMessages((msgs) => msgs.slice(0, -1));
			}
		}
	}, [wsMessages, wsSetMessages]);

	// ───────────────────────────────────────────────────────────
	// Handlers
	// ───────────────────────────────────────────────────────────

	/**
	 * Handle sending a message via WebSocket
	 *
	 * @param {string} messageContent The message to send
	 */
	const handleSendMessage = useCallback(
		(messageContent) => {
			// Reset editor-specific state
			setExecutedTools([]);
			executedToolsRef.current = [];
			setPendingTools([]);
			setActiveToolCall(null);
			setToolProgress(null);
			setLocalStatusOverride(null);

			// Build editor context and enrich the user's message.
			// On the first message of each conversation, include the system prompt
			// so the AI receives all block-editing rules (color validation, inner
			// block preservation, template parts, pattern library, etc.).
			const editorContext = buildEditorContext();
			let enrichedContent;
			if (isFirstMessageRef.current) {
				enrichedContent = `<system_instructions>\n${EDITOR_SYSTEM_PROMPT}\n</system_instructions>\n\n<editor_context>\n${editorContext}\n</editor_context>\n\n${messageContent}`;
				isFirstMessageRef.current = false;
			} else {
				enrichedContent = `<editor_context>\n${editorContext}\n</editor_context>\n\n${messageContent}`;
			}

			// Send via WebSocket (the hook appends the user message to state)
			wsSendMessage(enrichedContent);

			// Strip the system_instructions and editor_context wrappers from
			// the displayed user message so the user only sees their original text.
			// Search backwards because the WS hook may append a fallback error
			// message after the user message (e.g. on connection failure).
			wsSetMessages((prev) => {
				for (let i = prev.length - 1; i >= 0; i--) {
					const hasContext =
						prev[i].role === "user" &&
						(prev[i].content?.includes("<editor_context>") ||
							prev[i].content?.includes("<system_instructions>"));
					if (hasContext) {
						return [
							...prev.slice(0, i),
							{ ...prev[i], content: messageContent },
							...prev.slice(i + 1),
						];
					}
				}
				return prev;
			});
		},
		[wsSendMessage, wsSetMessages]
	);

	/**
	 * Start a new chat session
	 */
	const handleNewChat = useCallback(async () => {
		// Archive the outgoing conversation before clearing
		archiveConversation(wsMessagesRef.current, getSessionId(), null, EDITOR_CHAT_CONSUMER);

		// Clear WebSocket hook state (messages, conversationId, sessionId, localStorage)
		wsClearChatHistory();

		// Reset editor-specific state
		isFirstMessageRef.current = true;
		setHasGlobalStylesChanges(false);
		setExecutedTools([]);
		executedToolsRef.current = [];
		setPendingTools([]);
		setActiveToolCall(null);
		setToolProgress(null);
		setLocalStatusOverride(null);
		originalGlobalStylesRef.current = null;
		blockSnapshotRef.current = null;

		// Reconnect with fresh session
		wsConnect();

		if (mcpConnectionStatus !== "connected") {
			await initializeMCP();
		}
	}, [wsClearChatHistory, wsConnect, getSessionId, mcpConnectionStatus, initializeMCP]);

	/**
	 * Accept changes - trigger WordPress save
	 */
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

		// Save any dirty template-part entities
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
			console.error("[TP-SAVE] ✗ Error saving template parts:", tpError);
		}

		// Clear block snapshot on accept — changes are now permanent
		blockSnapshotRef.current = null;

		// Notify the AI that the user accepted the changes
		wsSetMessages((prev) => [
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
		wsSetMessages,
	]);

	/**
	 * Decline changes - restore to initial state
	 */
	const handleDeclineChanges = useCallback(async () => {
		const firstActionMessage = wsMessages.find((msg) => msg.hasActions && msg.undoData);

		if (!firstActionMessage || !firstActionMessage.undoData) {
			console.error("No undo data available");
			return;
		}

		try {
			const undoData = firstActionMessage.undoData;

			if (undoData && typeof undoData === "object" && !Array.isArray(undoData)) {
				// Restore block snapshot using resetBlocks for atomic undo
				if (undoData.blocks && Array.isArray(undoData.blocks) && undoData.blocks.length > 0) {
					const { dispatch: wpDispatch } = wp.data;
					const { createBlock: wpCreateBlock } = wp.blocks;

					// Convert parsed snapshot blocks back to proper WordPress blocks
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

			wsSetMessages((prev) => [
				...prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions, undoData: msgUndoData, ...rest } = msg;
						return rest;
					}
					return msg;
				}),
				{
					id: `notification-${Date.now()}`,
					type: "notification",
					content:
						"The user declined the changes. All modifications have been reverted to their previous state. The page is back to how it was before your last edits.",
				},
			]);

			setHasGlobalStylesChanges(false);
			originalGlobalStylesRef.current = null;
			blockSnapshotRef.current = null;
		} catch (restoreError) {
			console.error("Error restoring changes:", restoreError);
		}
	}, [wsMessages, wsSetMessages]);

	/**
	 * Stop the current request
	 */
	const handleStopRequest = useCallback(() => {
		wsStopRequest();
		setActiveToolCall(null);
		setToolProgress(null);
		setPendingTools([]);
		setLocalStatusOverride(null);
	}, [wsStopRequest]);

	return {
		messages: displayMessages,
		isLoading,
		sessionId,
		error,
		status: effectiveStatus,
		isSaving,
		mcpConnectionStatus,
		tools,
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		connectionState,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
	};
};

export { CHAT_STATUS };
export default useEditorChat;
