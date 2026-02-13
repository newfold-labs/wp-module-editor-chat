/* eslint-disable no-undef, no-console */
/**
 * WordPress dependencies
 */
import { store as coreStore } from "@wordpress/core-data";
import { useDispatch, useSelect } from "@wordpress/data";
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies - from wp-module-ai-chat
 */
import { CHAT_STATUS, createMCPClient, createOpenAIClient } from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import actionExecutor from "../services/actionExecutor";
import patternLibrary from "../services/patternLibrary";
import { executeToolCalls } from "../services/toolExecutor";
import {
	loadSessionId,
	saveSessionId,
	loadMessages,
	saveMessages,
	clearChatData,
	generateSessionId,
} from "../utils/chatStorage";
import {
	EDITOR_SYSTEM_PROMPT,
	generateToolSummary,
	buildEditorContext,
} from "../utils/editorContext";

// Create editor-specific clients with the editor config
const mcpClient = createMCPClient({ configKey: "nfdEditorChat" });
const openaiClient = createOpenAIClient({
	configKey: "nfdEditorChat",
	apiPath: "",
	mode: "editor",
});

/**
 * useEditorChat Hook
 *
 * Editor-specific chat hook that uses services from wp-module-ai-chat
 * and adds editor-specific functionality like accept/decline, localStorage
 * persistence, and real-time visual updates for global styles.
 *
 * @return {Object} Chat state and handlers for the editor
 */
const useEditorChat = () => {
	// Initialize state from localStorage
	const savedSessionId = loadSessionId();
	const savedMessages = loadMessages();

	const [messages, setMessages] = useState(savedMessages || []);
	const [isLoading, setIsLoading] = useState(false);
	const [sessionId, setSessionId] = useState(savedSessionId || generateSessionId());
	const [error, setError] = useState(null);
	const [status, setStatus] = useState(null);
	const [isSaving, setIsSaving] = useState(false);
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);
	const [mcpConnectionStatus, setMcpConnectionStatus] = useState("disconnected");
	const [tools, setTools] = useState([]);
	const [activeToolCall, setActiveToolCall] = useState(null);
	const [toolProgress, setToolProgress] = useState(null);
	const [executedTools, setExecutedTools] = useState([]);
	const [pendingTools, setPendingTools] = useState([]);
	const [reasoningContent, setReasoningContent] = useState("");
	const [tokenUsage, setTokenUsage] = useState(null);

	const hasInitializedRef = useRef(false);
	const abortControllerRef = useRef(null);
	const originalGlobalStylesRef = useRef(null);
	const blockSnapshotRef = useRef(null);
	const chainOriginRef = useRef(null);
	const executedToolsRef = useRef([]);
	const messagesRef = useRef(messages);

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

	// Watch for save completion
	useEffect(() => {
		if (isSaving && !isSavingPost) {
			setMessages((prev) =>
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
	}, [isSaving, isSavingPost]);

	/**
	 * Initialize MCP client connection
	 */
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

		if (!savedSessionId) {
			saveSessionId(sessionId);
		}
		initializeMCP();
	}, [sessionId, savedSessionId, initializeMCP]);

	// Save session ID when it changes
	useEffect(() => {
		saveSessionId(sessionId);
	}, [sessionId]);

	// Save messages when they change
	useEffect(() => {
		if (messages.length > 0) {
			saveMessages(messages);
		}
	}, [messages]);

	// Keep refs in sync so callbacks can read latest values
	useEffect(() => {
		executedToolsRef.current = executedTools;
	}, [executedTools]);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	// Cleanup on unmount
	useEffect(() => {
		const controller = abortControllerRef.current;
		return () => {
			if (controller) {
				controller.abort();
			}
		};
	}, []);

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

	/**
	 * Finalize a tool chain: clear origin ref, mark origin message done, reset tool state.
	 */
	const finalizeChain = () => {
		const originId = chainOriginRef.current;
		if (originId) {
			const finalTools = executedToolsRef.current;
			setMessages((prev) =>
				prev.map((msg) => {
					if (msg.id === originId) {
						return {
							...msg,
							isExecutingTools: false,
							executedTools: finalTools,
						};
					}
					return msg;
				})
			);
		}
		chainOriginRef.current = null;
		setExecutedTools([]);
		setPendingTools([]);
	};

	/**
	 * Build the shared context object passed to executeToolCalls.
	 */
	const buildToolCtx = () => ({
		mcpClient,
		openaiClient,
		setMessages,
		setStatus,
		setIsLoading,
		setExecutedTools,
		setPendingTools,
		setActiveToolCall,
		setToolProgress,
		setHasGlobalStylesChanges,
		setReasoningContent,
		setTokenUsage,
		blockSnapshotRef,
		chainOriginRef,
		executedToolsRef,
		originalGlobalStylesRef,
		getMessages: () => messagesRef.current,
		finalizeChain,
		updateProgress,
		wait,
	});

	/**
	 * Handle sending a message with streaming support
	 *
	 * @param {string} messageContent The message to send
	 */
	const handleSendMessage = async (messageContent) => {
		setError(null);
		setStatus(null);
		setExecutedTools([]);
		setPendingTools([]);
		chainOriginRef.current = null;

		// Build editor context and enrich the user's message
		const editorContext = buildEditorContext();
		const enrichedContent = `<editor_context>\n${editorContext}\n</editor_context>\n\n${messageContent}`;

		const userMessage = {
			id: `user-${Date.now()}`,
			type: "user",
			role: "user",
			content: enrichedContent,
		};
		setMessages((prev) => [...prev, { ...userMessage, content: messageContent }]);
		setIsLoading(true);
		setStatus(CHAT_STATUS.GENERATING);

		abortControllerRef.current = new AbortController();

		try {
			const recentMessages = [...messages, userMessage].slice(-6);

			// Strip tool data from older messages to save tokens — keep only last 2 tool-bearing turns
			const toolBearingIndices = recentMessages
				.map((msg, i) => (msg.toolCalls?.length > 0 || msg.toolResults?.length > 0 ? i : -1))
				.filter((i) => i !== -1);
			const keepToolDataFrom = new Set(toolBearingIndices.slice(-2));

			const openaiMessages = [
				{ role: "system", content: EDITOR_SYSTEM_PROMPT },
				...openaiClient.convertMessagesToOpenAI(
					recentMessages.map((msg, i) => ({
						role: msg.type === "user" || msg.type === "notification" ? "user" : "assistant",
						content: msg.content ?? "",
						toolCalls: keepToolDataFrom.has(i) ? msg.toolCalls : undefined,
						toolResults: keepToolDataFrom.has(i) ? msg.toolResults : undefined,
					}))
				),
			];

			const openaiTools = mcpClient.isConnected() ? mcpClient.getToolsForOpenAI() : [];
			const assistantMessageId = `assistant-${Date.now()}`;
			let currentContent = "";

			setMessages((prev) => [
				...prev,
				{
					id: assistantMessageId,
					type: "assistant",
					role: "assistant",
					content: "",
					isStreaming: true,
				},
			]);

			await openaiClient.createStreamingCompletion(
				{
					model: "gpt-4.1-mini",
					messages: openaiMessages,
					tools: openaiTools.length > 0 ? openaiTools : undefined,
					tool_choice: openaiTools.length > 0 ? "auto" : undefined,
					temperature: 0.2,
					max_completion_tokens: 32000,
					mode: "editor",
				},
				(chunk) => {
					if (chunk.type === "reasoning") {
						setReasoningContent((prev) => prev + chunk.content);
					}
					if (chunk.type === "content") {
						setReasoningContent(""); // Clear reasoning when content starts
						currentContent += chunk.content;
						setMessages((prev) =>
							prev.map((msg) =>
								msg.id === assistantMessageId ? { ...msg, content: currentContent } : msg
							)
						);
					}
				},
				async (fullMessage, toolCallsResult, usage) => {
					if (usage) {
						setTokenUsage(usage);
					}

					// Ensure the user always sees at least a sentence before tool execution
					const displayMessage =
						!fullMessage && toolCallsResult?.length > 0
							? generateToolSummary(toolCallsResult)
							: fullMessage;

					setReasoningContent("");

					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? {
										...msg,
										content: displayMessage,
										isStreaming: false,
										toolCalls: toolCallsResult,
									}
								: msg
						)
					);

					if (toolCallsResult && toolCallsResult.length > 0 && mcpClient.isConnected()) {
						await executeToolCalls(
							toolCallsResult,
							assistantMessageId,
							openaiMessages,
							fullMessage,
							0,
							buildToolCtx()
						);
						return;
					}

					setIsLoading(false);
					setStatus(null);
				},
				(err) => {
					console.error("Streaming error:", err);
					const fallbackContent =
						currentContent || __("Sorry, an error occurred.", "wp-module-editor-chat");
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? { ...msg, content: fallbackContent, isStreaming: false }
								: msg
						)
					);
					setError(__("Something went wrong. Please try again.", "wp-module-editor-chat"));
					setIsLoading(false);
					setStatus(null);
				}
			);
		} catch (err) {
			if (err.name === "AbortError") {
				return;
			}
			console.error("Error sending message:", err);
			setError(
				__(
					"Sorry, I encountered an error processing your request. Please try again.",
					"wp-module-editor-chat"
				)
			);
			setIsLoading(false);
			setStatus(null);
		}
	};

	/**
	 * Start a new chat session
	 */
	const handleNewChat = async () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		setIsLoading(false);
		setStatus(null);
		setError(null);
		setMessages([]);
		setTokenUsage(null);
		setHasGlobalStylesChanges(false);
		originalGlobalStylesRef.current = null;
		blockSnapshotRef.current = null;
		chainOriginRef.current = null;

		const newSessionId = generateSessionId();
		setSessionId(newSessionId);
		clearChatData();
		saveSessionId(newSessionId);

		if (mcpConnectionStatus !== "connected") {
			await initializeMCP();
		}
	};

	/**
	 * Accept changes - trigger WordPress save
	 */
	const handleAcceptChanges = async () => {
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
	};

	/**
	 * Decline changes - restore to initial state
	 */
	const handleDeclineChanges = async () => {
		const firstActionMessage = messages.find((msg) => msg.hasActions && msg.undoData);

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
					await actionExecutor.restoreGlobalStyles(undoData.globalStyles);
				}
			} else if (Array.isArray(undoData)) {
				await actionExecutor.restoreBlocks(undoData);
			}

			setMessages((prev) => [
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
	};

	/**
	 * Stop the current request
	 */
	const handleStopRequest = () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		setMessages((prev) =>
			prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
		);

		setIsLoading(false);
		setStatus(null);
		setError(null);
	};

	// Warn when prompt tokens exceed 27K — conversation is getting large
	const contextLimitWarning = tokenUsage?.prompt_tokens > 27000;

	return {
		messages,
		isLoading,
		sessionId,
		error,
		status,
		isSaving,
		mcpConnectionStatus,
		tools,
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		reasoningContent,
		tokenUsage,
		contextLimitWarning,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
	};
};

export { CHAT_STATUS };
export default useEditorChat;
