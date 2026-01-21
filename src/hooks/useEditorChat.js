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
import {
	CHAT_STATUS,
	createMCPClient,
	createOpenAIClient,
	simpleHash,
} from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import actionExecutor from "../services/actionExecutor";
import { getCurrentGlobalStyles, updateGlobalPalette } from "../services/globalStylesService";

// Create editor-specific clients with the editor config
const mcpClient = createMCPClient({ configKey: "nfdEditorChat" });
const openaiClient = createOpenAIClient({
	configKey: "nfdEditorChat",
	apiPath: "",
	mode: "editor",
});

/**
 * Get site-specific localStorage keys for chat persistence
 *
 * @return {Object} Storage keys object with site-specific keys
 */
const getStorageKeys = () => {
	const siteId = simpleHash(window.nfdEditorChat?.homeUrl || "default");
	return {
		SESSION_ID: `nfd-editor-chat-session-id-${siteId}`,
		MESSAGES: `nfd-editor-chat-messages-${siteId}`,
	};
};

/**
 * Load session ID from localStorage
 *
 * @return {string|null} The session ID or null
 */
const loadSessionId = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		return localStorage.getItem(STORAGE_KEYS.SESSION_ID);
	} catch (error) {
		console.warn("Failed to load session ID from localStorage:", error);
		return null;
	}
};

/**
 * Save session ID to localStorage
 *
 * @param {string} sessionId The session ID to save
 */
const saveSessionId = (sessionId) => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		if (sessionId) {
			localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
		} else {
			localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
		}
	} catch (error) {
		console.warn("Failed to save session ID to localStorage:", error);
	}
};

/**
 * Load messages from localStorage
 *
 * @return {Array} Array of messages
 */
const loadMessages = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		const stored = localStorage.getItem(STORAGE_KEYS.MESSAGES);
		if (stored) {
			const messages = JSON.parse(stored);
			return messages
				.map((msg) => {
					const { hasActions, undoData, isStreaming, ...rest } = msg;
					return rest;
				})
				.filter((msg) => {
					if (msg.type === "user") {
						return true;
					}
					const hasContent = msg.content !== null && msg.content !== "";
					const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
					return hasContent || hasToolCalls;
				});
		}
		return [];
	} catch (error) {
		console.warn("Failed to load messages from localStorage:", error);
		return [];
	}
};

/**
 * Save messages to localStorage
 *
 * @param {Array} messages Array of messages to save
 */
const saveMessages = (messages) => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		const cleanMessages = messages.map(({ isStreaming, ...rest }) => rest);
		localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(cleanMessages));
	} catch (error) {
		console.warn("Failed to save messages to localStorage:", error);
	}
};

/**
 * Clear all chat data from localStorage
 */
const clearChatData = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
		localStorage.removeItem(STORAGE_KEYS.MESSAGES);
	} catch (error) {
		console.warn("Failed to clear chat data from localStorage:", error);
	}
};

/**
 * Generate a new session ID
 *
 * @return {string} New session ID
 */
const generateSessionId = () => {
	return crypto.randomUUID
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

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

	const hasInitializedRef = useRef(false);
	const abortControllerRef = useRef(null);
	const originalGlobalStylesRef = useRef(null);

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
	 * Handle tool calls from OpenAI response
	 *
	 * @param {Array}  toolCalls          Tool calls from OpenAI
	 * @param {string} assistantMessageId ID of the assistant message
	 * @param {Array}  previousMessages   Previous messages for context
	 */
	const handleToolCalls = async (toolCalls, assistantMessageId, previousMessages) => {
		const toolResults = [];
		const completedToolsList = [];
		let globalStylesUndoData = null;

		setStatus(CHAT_STATUS.TOOL_CALL);
		await updateProgress(__("Preparing to execute actions…", "wp-module-editor-chat"), 300);

		setPendingTools(
			toolCalls.map((tc, idx) => ({
				...tc,
				id: tc.id || `tool-${idx}`,
			}))
		);
		setExecutedTools([]);

		setMessages((prev) =>
			prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, isExecutingTools: true } : msg))
		);

		for (let i = 0; i < toolCalls.length; i++) {
			const toolCall = toolCalls[i];
			const toolIndex = i + 1;
			const totalTools = toolCalls.length;

			setPendingTools((prev) => prev.filter((_, idx) => idx !== 0));
			setActiveToolCall({
				id: toolCall.id || `tool-${i}`,
				name: toolCall.name,
				arguments: toolCall.arguments,
				index: toolIndex,
				total: totalTools,
			});

			try {
				const toolName = toolCall.name || "";
				const args = toolCall.arguments || {};

				// Handle global palette update via JS service for real-time updates
				if (toolName === "blu-update-global-palette") {
					await updateProgress(__("Reading current color palette…", "wp-module-editor-chat"), 500);

					try {
						await updateProgress(
							__("Applying new colors to your site…", "wp-module-editor-chat"),
							600
						);
						const jsResult = await updateGlobalPalette(args.colors, args.replace_all);

						if (jsResult.success) {
							await updateProgress(
								__("✓ Colors updated! Review and Accept or Decline.", "wp-module-editor-chat"),
								800
							);
							setHasGlobalStylesChanges(true);

							if (jsResult.undoData && !originalGlobalStylesRef.current) {
								originalGlobalStylesRef.current = jsResult.undoData;
							}
							if (originalGlobalStylesRef.current) {
								globalStylesUndoData = originalGlobalStylesRef.current;
							}

							const { undoData: _unused, ...resultForAI } = jsResult;
							toolResults.push({
								id: toolCall.id,
								result: [{ type: "text", text: JSON.stringify(resultForAI) }],
								isError: false,
								hasChanges: true,
							});
							completedToolsList.push({ ...toolCall, isError: false });
							setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
							continue;
						}
						await updateProgress(
							__("Retrying with alternative method…", "wp-module-editor-chat"),
							400
						);
					} catch (jsError) {
						console.error("JS update threw error:", jsError);
						await updateProgress(
							__("Retrying with alternative method…", "wp-module-editor-chat"),
							400
						);
					}

					// Fallback to MCP
					const result = await mcpClient.callTool(toolCall.name, toolCall.arguments);
					toolResults.push({
						id: toolCall.id,
						result: result.content,
						isError: result.isError,
					});
					completedToolsList.push({ ...toolCall, isError: result.isError });
					setExecutedTools((prev) => [...prev, { ...toolCall, isError: result.isError }]);
					continue;
				}

				// Handle get global styles via JS service
				if (toolName === "blu-get-global-styles") {
					await updateProgress(__("Reading site color palette…", "wp-module-editor-chat"), 500);

					try {
						await updateProgress(__("Analyzing theme settings…", "wp-module-editor-chat"), 600);
						const jsResult = getCurrentGlobalStyles();

						if (jsResult.palette?.length > 0 || jsResult.rawSettings) {
							const colorCount = jsResult.palette?.length || 0;
							await updateProgress(`✓ Found ${colorCount} colors in palette`, 700);
							toolResults.push({
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
							});
							completedToolsList.push({ ...toolCall, isError: false });
							setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
							continue;
						}
						await updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
					} catch (jsError) {
						console.error("JS get styles threw error:", jsError);
						await updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
					}
				}

				// Default: use MCP for all other tool calls
				await updateProgress(__("Communicating with WordPress…", "wp-module-editor-chat"), 400);
				const result = await mcpClient.callTool(toolCall.name, toolCall.arguments);
				await updateProgress(__("Processing response…", "wp-module-editor-chat"), 300);
				toolResults.push({ id: toolCall.id, result: result.content, isError: result.isError });
				completedToolsList.push({ ...toolCall, isError: result.isError });
				setExecutedTools((prev) => [...prev, { ...toolCall, isError: result.isError }]);
			} catch (err) {
				console.error(`Tool call ${toolCall.name} failed:`, err);
				await updateProgress(
					__("Action failed:", "wp-module-editor-chat") + " " + err.message,
					1000
				);
				toolResults.push({ id: toolCall.id, result: null, error: err.message });
				completedToolsList.push({ ...toolCall, isError: true, errorMessage: err.message });
				setExecutedTools((prev) => [
					...prev,
					{ ...toolCall, isError: true, errorMessage: err.message },
				]);
			}
		}

		await updateProgress(__("✓ Actions completed", "wp-module-editor-chat"), 500);
		const hasChanges = toolResults.some((r) => r.hasChanges);

		setMessages((prev) =>
			prev.map((msg) =>
				msg.id === assistantMessageId
					? {
							...msg,
							toolResults,
							executedTools: completedToolsList,
							isExecutingTools: false,
							...(hasChanges && globalStylesUndoData
								? { hasActions: true, undoData: globalStylesUndoData }
								: {}),
						}
					: msg
			)
		);

		setActiveToolCall(null);
		setToolProgress(null);
		setExecutedTools([]);
		setPendingTools([]);

		// Get follow-up response if we have successful results
		if (toolResults.some((r) => !r.error)) {
			setStatus(CHAT_STATUS.SUMMARIZING);

			try {
				const toolResultsSummary = toolResults
					.map((r) => {
						if (r.error) {
							return `Tool failed: ${r.error}`;
						}
						const resultText = Array.isArray(r.result)
							? r.result.map((item) => item.text || JSON.stringify(item)).join("\n")
							: JSON.stringify(r.result);
						return resultText;
					})
					.join("\n\n");

				const followUpMessageId = `assistant-followup-${Date.now()}`;
				let followUpContent = "";

				setMessages((prev) => [
					...prev,
					{
						id: followUpMessageId,
						type: "assistant",
						role: "assistant",
						content: "",
						isStreaming: true,
					},
				]);

				const followUpMessages = [
					...openaiClient.convertMessagesToOpenAI(previousMessages.slice(0, -1)),
					{
						role: "user",
						content: `Here are the results from the tool execution:\n\n${toolResultsSummary}\n\nPlease provide a brief, helpful summary of what was done for the user. Be concise.`,
					},
				];

				await openaiClient.createStreamingCompletion(
					{
						model: "gpt-4o-mini",
						messages: followUpMessages,
						tools: [],
						temperature: 0.7,
						max_tokens: 500,
						mode: "editor",
					},
					(chunk) => {
						if (chunk.type === "content") {
							followUpContent += chunk.content;
							setMessages((prev) =>
								prev.map((msg) =>
									msg.id === followUpMessageId ? { ...msg, content: followUpContent } : msg
								)
							);
						}
					},
					async (fullMessage) => {
						setMessages((prev) =>
							prev.map((msg) =>
								msg.id === followUpMessageId
									? { ...msg, content: fullMessage, isStreaming: false }
									: msg
							)
						);
						setStatus(null);
						setIsLoading(false);
					},
					(err) => {
						console.error("Follow-up streaming error:", err);
						setMessages((prev) =>
							prev.map((msg) =>
								msg.id === followUpMessageId
									? { ...msg, content: followUpContent || "Done.", isStreaming: false }
									: msg
							)
						);
						setStatus(null);
						setIsLoading(false);
					}
				);
			} catch (followUpError) {
				console.error("Follow-up response failed:", followUpError);
				setStatus(null);
				setIsLoading(false);
			}
		} else {
			setStatus(null);
			setIsLoading(false);
		}
	};

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

		const userMessage = {
			id: `user-${Date.now()}`,
			type: "user",
			role: "user",
			content: messageContent,
		};
		setMessages((prev) => [...prev, userMessage]);
		setIsLoading(true);
		setStatus(CHAT_STATUS.GENERATING);

		abortControllerRef.current = new AbortController();

		try {
			const recentMessages = [...messages, userMessage].slice(-10);
			const openaiMessages = openaiClient.convertMessagesToOpenAI(
				recentMessages.map((msg) => ({
					role: msg.type === "user" ? "user" : "assistant",
					content: msg.content ?? "",
					toolCalls: msg.toolCalls,
					toolResults: msg.toolResults,
				}))
			);

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
					model: "gpt-4o-mini",
					messages: openaiMessages,
					tools: openaiTools.length > 0 ? openaiTools : undefined,
					tool_choice: openaiTools.length > 0 ? "auto" : undefined,
					temperature: 0.7,
					max_tokens: 2000,
					mode: "editor",
				},
				(chunk) => {
					if (chunk.type === "content") {
						currentContent += chunk.content;
						setMessages((prev) =>
							prev.map((msg) =>
								msg.id === assistantMessageId ? { ...msg, content: currentContent } : msg
							)
						);
					}
				},
				async (fullMessage, toolCallsResult) => {
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? { ...msg, content: fullMessage, isStreaming: false, toolCalls: toolCallsResult }
								: msg
						)
					);

					if (toolCallsResult && toolCallsResult.length > 0 && mcpClient.isConnected()) {
						await handleToolCalls(toolCallsResult, assistantMessageId, openaiMessages);
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
					setError(
						err.message ||
							__("An error occurred while processing your request.", "wp-module-editor-chat")
					);
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
		setHasGlobalStylesChanges(false);
		originalGlobalStylesRef.current = null;

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
				if (undoData.blocks && Array.isArray(undoData.blocks) && undoData.blocks.length > 0) {
					await actionExecutor.restoreBlocks(undoData.blocks);
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

			setMessages((prev) =>
				prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions, undoData: msgUndoData, ...rest } = msg;
						return rest;
					}
					return msg;
				})
			);

			setHasGlobalStylesChanges(false);
			originalGlobalStylesRef.current = null;
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
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
	};
};

export { CHAT_STATUS };
export default useEditorChat;
