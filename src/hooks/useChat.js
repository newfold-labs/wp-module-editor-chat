/* eslint-disable no-undef */
/**
 * WordPress dependencies
 */
import { useEffect, useState, useRef, useCallback } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { useDispatch, useSelect } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";

/**
 * Internal dependencies
 */
import actionExecutor from "../services/actionExecutor";
import { simpleHash } from "../utils/helpers";
import { mcpClient, MCPError } from "../services/mcpClient";
import { openaiClient } from "../services/openaiClient";

/**
 * Get site-specific localStorage keys for chat persistence
 * Uses the site URL to ensure each site has its own isolated chat history
 *
 * @return {Object} Storage keys object with site-specific keys
 */
const getStorageKeys = () => {
	// Hash the site home URL to create a unique, compact identifier
	const siteId = simpleHash(window.nfdEditorChat.homeUrl);

	return {
		MESSAGES: `nfd-editor-chat-messages-${siteId}`,
	};
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
			// Remove hasActions, undoData, and streaming state from loaded messages
			return messages.map((msg) => {
				const { hasActions, undoData, isStreaming, ...rest } = msg;
				return rest;
			});
		}
		return [];
	} catch (error) {
		// eslint-disable-next-line no-console
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
		// Filter out streaming state before saving
		const messagesToSave = messages.map((msg) => {
			const { isStreaming, ...rest } = msg;
			return rest;
		});
		localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messagesToSave));
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn("Failed to save messages to localStorage:", error);
	}
};

/**
 * Clear all chat data from localStorage
 */
const clearChatData = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		localStorage.removeItem(STORAGE_KEYS.MESSAGES);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn("Failed to clear chat data from localStorage:", error);
	}
};

/**
 * Custom hook for managing chat functionality with streaming and MCP integration
 *
 * @return {Object} Chat state and handlers
 */
const useChat = () => {
	// Initialize state from localStorage immediately
	const savedMessages = loadMessages();

	const [messages, setMessages] = useState(savedMessages || []);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState(null);
	const [status, setStatus] = useState(null); // 'connecting', 'streaming', 'tool_calling', 'completed'
	const [isSaving, setIsSaving] = useState(false);
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);
	const [streamingContent, setStreamingContent] = useState("");
	const [currentToolCalls, setCurrentToolCalls] = useState([]);
	const [pendingToolPermission, setPendingToolPermission] = useState(null);
	const [mcpTools, setMcpTools] = useState([]);
	const [mcpConnectionStatus, setMcpConnectionStatus] = useState("disconnected"); // 'disconnected', 'connecting', 'connected'

	const hasInitializedRef = useRef(false);
	const messageIdRef = useRef(0);

	// Get WordPress editor dispatch functions
	const { savePost } = useDispatch("core/editor");
	const { saveEditedEntityRecord } = useDispatch(coreStore);
	const { __experimentalGetCurrentGlobalStylesId } = useSelect(
		(select) => ({
			__experimentalGetCurrentGlobalStylesId: select(coreStore).__experimentalGetCurrentGlobalStylesId,
		}),
		[]
	);

	// Get WordPress save status
	const isSavingPost = useSelect((select) => select("core/editor").isSavingPost(), []);

	// Watch for save completion
	useEffect(() => {
		if (isSaving && !isSavingPost) {
			// Save just completed
			// Remove hasActions and undoData from ALL messages
			setMessages((prev) =>
				prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions, undoData, ...rest } = msg;
						return rest;
					}
					return msg;
				})
			);

			// Reset global styles changes flag
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

			const tools = mcpClient.getTools();
			setMcpTools(tools);
			setMcpConnectionStatus("connected");

			// eslint-disable-next-line no-console
			console.log(`MCP connected with ${tools.length} tools available`);
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("Failed to initialize MCP:", err);
			setMcpConnectionStatus("disconnected");
			// Don't block chat if MCP fails - just continue without tools
		}
	}, [mcpConnectionStatus]);

	// Initialize MCP on mount
	useEffect(() => {
		if (hasInitializedRef.current) {
			return;
		}

		hasInitializedRef.current = true;
		initializeMCP();
	}, [initializeMCP]);

	// Save messages when they change
	useEffect(() => {
		if (messages.length > 0) {
			saveMessages(messages);
		}
	}, [messages]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			openaiClient.stop();
			if (mcpClient.isConnected()) {
				mcpClient.disconnect();
			}
		};
	}, []);

	/**
	 * Generate a unique message ID
	 *
	 * @return {string} Unique message ID
	 */
	const generateMessageId = () => {
		messageIdRef.current += 1;
		return `msg-${Date.now()}-${messageIdRef.current}`;
	};

	/**
	 * Execute a tool call with permission checking
	 *
	 * @param {Object} toolCall Tool call object with name and arguments
	 * @return {Promise<Object>} Tool result
	 */
	const executeToolCall = async (toolCall) => {
		const { name, arguments: args } = toolCall;

		try {
			const result = await mcpClient.callTool(name, args);

			return {
				id: toolCall.id,
				name,
				result: result.content,
				isError: result.isError,
			};
		} catch (err) {
			return {
				id: toolCall.id,
				name,
				result: null,
				error: err.message || "Tool execution failed",
				isError: true,
			};
		}
	};

	/**
	 * Check if any tools require permission (are destructive)
	 *
	 * @param {Array} toolCalls Array of tool calls
	 * @return {Array} Array of destructive tool calls
	 */
	const getDestructiveToolCalls = (toolCalls) => {
		return toolCalls.filter((tc) => !mcpClient.isToolReadOnly(tc.name));
	};

	/**
	 * Continue chat after tool results
	 *
	 * @param {Array}  chatHistory   Current chat history
	 * @param {Array}  toolResults   Results from tool execution
	 * @param {Object} assistantMsg  Original assistant message with tool calls
	 * @return {Promise<void>}
	 */
	const continueWithToolResults = async (chatHistory, toolResults, assistantMsg) => {
		const tools = mcpClient.getToolsForOpenAI();

		// Build messages including the tool results
		const messagesForAPI = openaiClient.convertMessagesToOpenAI([
			{ role: "system", content: openaiClient.createSystemMessage().content },
			...chatHistory,
			{
				role: "assistant",
				content: assistantMsg.content || "",
				toolCalls: assistantMsg.toolCalls,
				toolResults,
			},
		]);

		// Create a new streaming message for the follow-up response
		const followUpMsgId = generateMessageId();
		setStreamingContent("");
		setStatus("streaming");

		setMessages((prev) => [
			...prev,
			{
				id: followUpMsgId,
				type: "assistant",
				content: "",
				isStreaming: true,
			},
		]);

		await openaiClient.createStreamingCompletion(
			{
				messages: messagesForAPI,
				tools: tools.length > 0 ? tools : undefined,
			},
			// onChunk
			(chunk) => {
				if (chunk.type === "content") {
					setStreamingContent((prev) => prev + chunk.content);
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === followUpMsgId ? { ...msg, content: chunk.fullContent } : msg
						)
					);
				}
			},
			// onToolCall - handle nested tool calls
			async (newToolCalls) => {
				setStatus("tool_calling");
				// Execute new tool calls
				const newResults = await Promise.all(newToolCalls.map(executeToolCall));

				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === followUpMsgId
							? {
									...msg,
									toolCalls: newToolCalls,
									toolResults: newResults,
								}
							: msg
					)
				);

				// Continue with new tool results if needed
				const currentMessages = messages.filter((m) => m.id !== followUpMsgId);
				await continueWithToolResults(currentMessages, newResults, {
					content: streamingContent,
					toolCalls: newToolCalls,
				});
			},
			// onComplete
			(result) => {
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === followUpMsgId ? { ...msg, content: result.content, isStreaming: false } : msg
					)
				);
				setStreamingContent("");
				setStatus(null);
				setIsLoading(false);
			},
			// onError
			(err) => {
				setError(err.message || "Failed to get AI response");
				setIsLoading(false);
				setStatus(null);
			}
		);
	};

	/**
	 * Handle sending a message with streaming
	 *
	 * @param {string} messageContent User message content
	 */
	const handleSendMessage = async (messageContent) => {
		// Clear any previous errors and status
		setError(null);
		setStatus(null);
		setStreamingContent("");
		setCurrentToolCalls([]);

		// Add user message
		const userMsgId = generateMessageId();
		const userMessage = {
			id: userMsgId,
			type: "user",
			content: messageContent,
		};
		setMessages((prev) => [...prev, userMessage]);
		setIsLoading(true);
		setStatus("streaming");

		try {
			// Build chat history for context
			const chatHistory = [...messages, userMessage].slice(-20); // Keep last 20 messages for context

			// Get MCP tools in OpenAI format
			const tools = mcpClient.isConnected() ? mcpClient.getToolsForOpenAI() : [];

			// Build messages for OpenAI API
			const messagesForAPI = openaiClient.convertMessagesToOpenAI([
				{ role: "system", content: openaiClient.createSystemMessage().content },
				...chatHistory.map((msg) => ({
					role: msg.type === "user" ? "user" : "assistant",
					content: msg.content,
					toolCalls: msg.toolCalls,
					toolResults: msg.toolResults,
				})),
			]);

			// Create assistant message placeholder for streaming
			const assistantMsgId = generateMessageId();
			setMessages((prev) => [
				...prev,
				{
					id: assistantMsgId,
					type: "assistant",
					content: "",
					isStreaming: true,
				},
			]);

			let finalToolCalls = null;

			await openaiClient.createStreamingCompletion(
				{
					messages: messagesForAPI,
					tools: tools.length > 0 ? tools : undefined,
				},
				// onChunk - handle streaming content
				(chunk) => {
					if (chunk.type === "content") {
						setStreamingContent(chunk.fullContent);
						setMessages((prev) =>
							prev.map((msg) =>
								msg.id === assistantMsgId ? { ...msg, content: chunk.fullContent } : msg
							)
						);
					}
				},
				// onToolCall - handle tool calls
				(toolCalls) => {
					finalToolCalls = toolCalls;
					setCurrentToolCalls(toolCalls);
					setStatus("tool_calling");

					// Update message with tool calls
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMsgId ? { ...msg, toolCalls, isStreaming: false } : msg
						)
					);
				},
				// onComplete - handle completion
				async (result) => {
					// Update message with final content
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMsgId
								? { ...msg, content: result.content, isStreaming: false }
								: msg
						)
					);

					// If there were tool calls, execute them
					if (finalToolCalls && finalToolCalls.length > 0) {
						// Check for destructive tools that need permission
						const destructiveTools = getDestructiveToolCalls(finalToolCalls);

						if (destructiveTools.length > 0) {
							// Set pending permission state
							setPendingToolPermission({
								toolCalls: finalToolCalls,
								assistantMsgId,
								chatHistory,
							});
							setStatus("awaiting_permission");
							return;
						}

						// Execute all tool calls
						const toolResults = await Promise.all(finalToolCalls.map(executeToolCall));

						// Update message with tool results
						setMessages((prev) =>
							prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, toolResults } : msg))
						);

						// Continue conversation with tool results
						await continueWithToolResults(chatHistory, toolResults, {
							content: result.content,
							toolCalls: finalToolCalls,
						});
					} else {
						setStreamingContent("");
						setStatus(null);
						setIsLoading(false);
					}
				},
				// onError
				(err) => {
					// eslint-disable-next-line no-console
					console.error("Streaming error:", err);
					setError(
						__(
							"Sorry, I encountered an error processing your request. Please try again.",
							"wp-module-editor-chat"
						)
					);
					setIsLoading(false);
					setStatus(null);

					// Remove the streaming message on error
					setMessages((prev) => prev.filter((msg) => msg.id !== assistantMsgId));
				}
			);
		} catch (err) {
			// eslint-disable-next-line no-console
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
	 * Approve pending tool permission and execute tools
	 */
	const handleApproveToolPermission = async () => {
		if (!pendingToolPermission) {
			return;
		}

		const { toolCalls, assistantMsgId, chatHistory } = pendingToolPermission;
		setPendingToolPermission(null);
		setStatus("tool_calling");

		// Execute all tool calls
		const toolResults = await Promise.all(toolCalls.map(executeToolCall));

		// Update message with tool results
		setMessages((prev) => prev.map((msg) => (msg.id === assistantMsgId ? { ...msg, toolResults } : msg)));

		// Get the current message content
		const currentMsg = messages.find((m) => m.id === assistantMsgId);
		const content = currentMsg?.content || "";

		// Continue conversation with tool results
		await continueWithToolResults(chatHistory, toolResults, {
			content,
			toolCalls,
		});
	};

	/**
	 * Deny pending tool permission
	 */
	const handleDenyToolPermission = () => {
		setPendingToolPermission(null);
		setStatus(null);
		setIsLoading(false);

		// Add a message indicating tools were not executed
		setMessages((prev) => [
			...prev,
			{
				id: generateMessageId(),
				type: "assistant",
				content: __(
					"I understand. The requested actions were not performed. How else can I help you?",
					"wp-module-editor-chat"
				),
			},
		]);
	};

	/**
	 * Handle starting a new chat
	 */
	const handleNewChat = async () => {
		// Stop any active requests
		openaiClient.stop();

		// Clear loading and status states
		setIsLoading(false);
		setStatus(null);
		setStreamingContent("");
		setCurrentToolCalls([]);
		setPendingToolPermission(null);

		// Reset messages
		setMessages([]);
		setError(null);

		// Clear localStorage data
		clearChatData();
	};

	/**
	 * Accept changes - trigger WordPress save and keep buttons visible until save completes
	 */
	const handleAcceptChanges = async () => {
		// Set saving state to true - this will disable the buttons
		setIsSaving(true);

		// Save global styles if they were changed
		if (hasGlobalStylesChanges) {
			try {
				const globalStylesId = __experimentalGetCurrentGlobalStylesId
					? __experimentalGetCurrentGlobalStylesId()
					: undefined;

				if (globalStylesId) {
					await saveEditedEntityRecord("root", "globalStyles", globalStylesId);
				}
			} catch (saveError) {
				// eslint-disable-next-line no-console
				console.error("Error saving global styles:", saveError);
			}
		}

		// Trigger WordPress save/publish
		if (savePost) {
			savePost();
		}
	};

	/**
	 * Decline changes - restore to initial state before first action and hide buttons
	 */
	const handleDeclineChanges = async () => {
		// Find the first message with undo data (the initial state)
		const firstActionMessage = messages.find((msg) => msg.hasActions && msg.undoData);

		if (!firstActionMessage || !firstActionMessage.undoData) {
			// eslint-disable-next-line no-console
			console.error("No undo data available");
			return;
		}

		try {
			const undoData = firstActionMessage.undoData;

			// Handle new structure: { blocks: [], globalStyles: {...} }
			if (undoData && typeof undoData === "object" && !Array.isArray(undoData)) {
				// Restore blocks if they exist
				if (undoData.blocks && Array.isArray(undoData.blocks) && undoData.blocks.length > 0) {
					await actionExecutor.restoreBlocks(undoData.blocks);
				}

				// Restore global styles if they exist
				if (
					undoData.globalStyles &&
					undoData.globalStyles.originalStyles &&
					undoData.globalStyles.globalStylesId
				) {
					await actionExecutor.restoreGlobalStyles(undoData.globalStyles);
				}
			} else if (Array.isArray(undoData)) {
				// Handle old structure: array of blocks (backward compatibility)
				await actionExecutor.restoreBlocks(undoData);
			}

			// Remove hasActions and undoData from ALL messages
			setMessages((prev) =>
				prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions, undoData: msgUndoData, ...rest } = msg;
						return rest;
					}
					return msg;
				})
			);

			// Reset global styles changes flag
			setHasGlobalStylesChanges(false);
		} catch (restoreError) {
			// eslint-disable-next-line no-console
			console.error("Error restoring changes:", restoreError);
		}
	};

	/**
	 * Stop the current request
	 */
	const handleStopRequest = () => {
		openaiClient.stop();
		setIsLoading(false);
		setStatus(null);
		setError(null);
		setStreamingContent("");
	};

	/**
	 * Reconnect MCP client
	 */
	const handleReconnectMCP = async () => {
		if (mcpClient.isConnected()) {
			await mcpClient.disconnect();
		}
		setMcpConnectionStatus("disconnected");
		await initializeMCP();
	};

	return {
		messages,
		isLoading,
		error,
		status,
		isSaving,
		streamingContent,
		currentToolCalls,
		pendingToolPermission,
		mcpTools,
		mcpConnectionStatus,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
		handleApproveToolPermission,
		handleDenyToolPermission,
		handleReconnectMCP,
	};
};

export default useChat;
