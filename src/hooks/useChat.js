/* eslint-disable no-undef, no-console */
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
import { mcpClient } from "../services/mcpClient";
import { openaiClient } from "../services/openaiClient";
import actionExecutor from "../services/actionExecutor";
import { simpleHash } from "../utils/helpers";
import { updateGlobalPalette, getCurrentGlobalStyles } from "../services/globalStylesService";

/**
 * Get site-specific localStorage keys for chat persistence
 * Uses the site URL to ensure each site has its own isolated chat history
 *
 * @return {Object} Storage keys object with site-specific keys
 */
const getStorageKeys = () => {
	// Hash the site home URL to create a unique, compact identifier
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
			// Remove hasActions and undoData from loaded messages (actions should only show once)
			// Also filter out invalid assistant messages (no content and no tool calls)
			return messages
				.map((msg) => {
					const { hasActions, undoData, isStreaming, ...rest } = msg;
					return rest;
				})
				.filter((msg) => {
					// Keep all user messages
					if (msg.type === "user") {
						return true;
					}
					// For assistant messages, require either content or toolCalls
					const hasContent = msg.content !== null && msg.content !== "";
					const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
					if (!hasContent && !hasToolCalls) {
						console.warn("Filtering out invalid assistant message from localStorage");
						return false;
					}
					return true;
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
		// Filter out streaming state before saving
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
 * Custom hook for managing chat functionality with MCP and streaming support
 *
 * @return {Object} Chat state and handlers
 */
const useChat = () => {
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
	const [toolProgress, setToolProgress] = useState(null); // For streaming tool progress
	const [executedTools, setExecutedTools] = useState([]); // Completed tool executions
	const [pendingTools, setPendingTools] = useState([]); // Queued tools waiting to execute

	const hasInitializedRef = useRef(false);
	const abortControllerRef = useRef(null);
	const originalGlobalStylesRef = useRef(null); // Track original global styles for revert all

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
			// Save just completed - remove hasActions and undoData from ALL messages
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

			const availableTools = await mcpClient.listTools();
			setTools(availableTools);

			setMcpConnectionStatus("connected");
		} catch (err) {
			console.error("Failed to initialize MCP:", err);
			setMcpConnectionStatus("disconnected");
			// Don't set error here - MCP is optional, chat can work without it
		}
	}, [mcpConnectionStatus]);

	// Initialize on mount
	useEffect(() => {
		if (hasInitializedRef.current) {
			return;
		}

		hasInitializedRef.current = true;

		// Save session ID if it's new
		if (!savedSessionId) {
			saveSessionId(sessionId);
		}

		// Initialize MCP connection
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
		return () => {
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
		};
	}, []);

	/**
	 * Handle sending a message with streaming support
	 *
	 * @param {string} messageContent The message to send
	 */
	const handleSendMessage = async (messageContent) => {
		// Clear any previous errors and tool execution state
		setError(null);
		setStatus(null);
		setExecutedTools([]);
		setPendingTools([]);

		// Add user message
		const userMessage = {
			id: `user-${Date.now()}`,
			type: "user",
			role: "user",
			content: messageContent,
		};
		setMessages((prev) => [...prev, userMessage]);
		setIsLoading(true);
		setStatus("generating");

		// Create abort controller for this request
		abortControllerRef.current = new AbortController();

		try {
			// Build message context for API (system prompt is injected server-side by cloud-patterns)
			const recentMessages = [...messages, userMessage].slice(-10);

			const openaiMessages = openaiClient.convertMessagesToOpenAI(
				recentMessages.map((msg) => ({
					role: msg.type === "user" ? "user" : "assistant",
					content: msg.content ?? "", // Ensure content is never null/undefined
					toolCalls: msg.toolCalls,
					toolResults: msg.toolResults,
				}))
			);

			// Get MCP tools in OpenAI format
			const openaiTools = mcpClient.isConnected() ? mcpClient.getToolsForOpenAI() : [];

			// Create streaming assistant message
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

			// Make streaming request
			await openaiClient.createStreamingCompletion(
				{
					model: "gpt-4o-mini",
					messages: openaiMessages,
					tools: openaiTools.length > 0 ? openaiTools : undefined,
					tool_choice: openaiTools.length > 0 ? "auto" : undefined,
					temperature: 0.7,
					max_tokens: 2000,
				},
				// onChunk callback
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
				// onComplete callback
				async (fullMessage, toolCallsResult) => {
					// Mark streaming as complete
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? {
										...msg,
										content: fullMessage,
										isStreaming: false,
										toolCalls: toolCallsResult,
									}
								: msg
						)
					);

					// Handle tool calls if present
					if (toolCallsResult && toolCallsResult.length > 0 && mcpClient.isConnected()) {
						// handleToolCalls will manage isLoading and status
						await handleToolCalls(toolCallsResult, assistantMessageId, openaiMessages);
						// Don't reset here - handleToolCalls manages the state
						return;
					}

					// Only reset if no tool calls
					setIsLoading(false);
					setStatus(null);
				},
				// onError callback
				(err) => {
					console.error("Streaming error:", err);
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? {
										...msg,
										content:
											currentContent || __("Sorry, an error occurred.", "wp-module-editor-chat"),
										isStreaming: false,
									}
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
	 * Helper to wait for a minimum time (for UX - so users can see progress)
	 *
	 * @param {number} ms Milliseconds to wait
	 * @return {Promise} Promise that resolves after ms
	 */
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	/**
	 * Update progress with minimum display time
	 *
	 * @param {string} message Progress message to show
	 * @param {number} minTime Minimum time to display (default 400ms)
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
		const completedToolsList = []; // Local tracking for tools (not relying on React state)
		let globalStylesUndoData = null; // Track undo data for global style changes

		// Set status to tool_call mode
		setStatus("tool_call");
		await updateProgress(__("Preparing to execute actions…", "wp-module-editor-chat"), 300);

		// Initialize pending tools list (all tools queued for execution)
		setPendingTools(
			toolCalls.map((tc, idx) => ({
				...tc,
				id: tc.id || `tool-${idx}`,
			}))
		);
		setExecutedTools([]);

		// Mark message as executing tools
		setMessages((prev) =>
			prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, isExecutingTools: true } : msg))
		);

		for (let i = 0; i < toolCalls.length; i++) {
			const toolCall = toolCalls[i];
			const toolIndex = i + 1;
			const totalTools = toolCalls.length;

			// Move current tool from pending to active
			setPendingTools((prev) => prev.filter((_, idx) => idx !== 0));

			// Set the active tool call for UI display
			setActiveToolCall({
				id: toolCall.id || `tool-${i}`,
				name: toolCall.name,
				arguments: toolCall.arguments,
				index: toolIndex,
				total: totalTools,
			});

			try {
				// Check if this is a global styles update - handle it via JS for real-time updates
				if (toolCall.name === "mcp-adapter-execute-ability") {
					const args = toolCall.arguments || {};
					const abilityName = args.ability_name;
					const params = args.parameters || {};

					console.log(
						"Tool call intercepted:",
						toolCall.name,
						"ability:",
						abilityName,
						"params:",
						params
					);

					// Handle global palette update via JS service for real-time updates
					if (abilityName === "blu/update-global-palette") {
						await updateProgress(
							__("Reading current color palette…", "wp-module-editor-chat"),
							500
						);
						console.log("=== Intercepting global palette update for real-time changes ===");
						console.log("Colors:", params.colors);
						console.log("Replace all:", params.replace_all);

						try {
							await updateProgress(
								__("Applying new colors to your site…", "wp-module-editor-chat"),
								600
							);
							const jsResult = await updateGlobalPalette(params.colors, params.replace_all);
							console.log("JS update result:", jsResult);

							if (jsResult.success) {
								await updateProgress(
									__("✓ Colors updated! Review and Accept or Decline.", "wp-module-editor-chat"),
									800
								);
								setHasGlobalStylesChanges(true);

								// Only capture original state ONCE (first change)
								// This ensures "Decline" reverts to the true original, not intermediate states
								if (jsResult.undoData && !originalGlobalStylesRef.current) {
									originalGlobalStylesRef.current = jsResult.undoData;
								}

								// Always use the first captured original state for undo
								if (originalGlobalStylesRef.current) {
									globalStylesUndoData = originalGlobalStylesRef.current;
								}

								// Strip undoData from result before sending to AI (it's internal/local only)
								const { undoData: _unused, ...resultForAI } = jsResult;

								toolResults.push({
									id: toolCall.id,
									result: [{ type: "text", text: JSON.stringify(resultForAI) }],
									isError: false,
									hasChanges: true, // Flag to indicate this tool made changes
								});
								// Mark tool as executed (success)
								completedToolsList.push({ ...toolCall, isError: false });
								setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
								continue;
							} else {
								// Fall back to MCP if JS fails
								await updateProgress(
									__("Retrying with alternative method…", "wp-module-editor-chat"),
									400
								);
								console.warn("JS update failed, falling back to MCP:", jsResult.error);
							}
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
						// Mark tool as executed (MCP fallback)
						completedToolsList.push({ ...toolCall, isError: result.isError });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: result.isError }]);
						continue;
					}

					// Handle get global styles via JS service for more accurate data
					if (abilityName === "blu/get-global-styles") {
						await updateProgress(__("Reading site color palette…", "wp-module-editor-chat"), 500);
						console.log("=== Intercepting get global styles for real-time data ===");

						try {
							await updateProgress(__("Analyzing theme settings…", "wp-module-editor-chat"), 600);
							const jsResult = getCurrentGlobalStyles();
							console.log("JS get styles result:", jsResult);

							// Check if we got valid data (palette has items or we have rawSettings)
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
								// Mark tool as executed (success)
								completedToolsList.push({ ...toolCall, isError: false });
								setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
								continue;
							} else {
								await updateProgress(
									__("Checking WordPress database…", "wp-module-editor-chat"),
									400
								);
								console.warn("JS get styles returned empty, falling back to MCP");
							}
						} catch (jsError) {
							console.error("JS get styles threw error:", jsError);
							await updateProgress(
								__("Checking WordPress database…", "wp-module-editor-chat"),
								400
							);
						}
						// Fall through to MCP if JS fails
					}

					// For other abilities, show generic progress
					const abilityShortName = abilityName.split("/").pop();
					await updateProgress(`Executing ${abilityShortName}…`, 400);
				}

				// Default: use MCP for all other tool calls
				await updateProgress(__("Communicating with WordPress…", "wp-module-editor-chat"), 400);
				const result = await mcpClient.callTool(toolCall.name, toolCall.arguments);
				await updateProgress(__("Processing response…", "wp-module-editor-chat"), 300);
				toolResults.push({
					id: toolCall.id,
					result: result.content,
					isError: result.isError,
				});
				// Mark tool as executed (default MCP path)
				completedToolsList.push({ ...toolCall, isError: result.isError });
				setExecutedTools((prev) => [...prev, { ...toolCall, isError: result.isError }]);
			} catch (err) {
				console.error(`Tool call ${toolCall.name} failed:`, err);
				await updateProgress(
					__("Action failed:", "wp-module-editor-chat") + " " + err.message,
					1000
				);
				toolResults.push({
					id: toolCall.id,
					result: null,
					error: err.message,
				});
				// Mark tool as executed with error
				completedToolsList.push({ ...toolCall, isError: true, errorMessage: err.message });
				setExecutedTools((prev) => [
					...prev,
					{ ...toolCall, isError: true, errorMessage: err.message },
				]);
			}
		}

		// Show completion briefly before transitioning
		await updateProgress(__("✓ Actions completed", "wp-module-editor-chat"), 500);

		// Check if any tools made changes that need accept/decline
		const hasChanges = toolResults.some((r) => r.hasChanges);

		// Update message with tool results and mark execution as complete
		setMessages((prev) =>
			prev.map((msg) =>
				msg.id === assistantMessageId
					? {
							...msg,
							toolResults,
							executedTools: completedToolsList, // Attach local list to message for inline rendering
							isExecutingTools: false,
							// Add hasActions and undoData if there are changes to accept/decline
							...(hasChanges && globalStylesUndoData
								? {
										hasActions: true,
										undoData: globalStylesUndoData,
									}
								: {}),
						}
					: msg
			)
		);

		// Clear active tool call, progress, and global executedTools (now stored on message)
		setActiveToolCall(null);
		setToolProgress(null);
		setExecutedTools([]);
		setPendingTools([]);

		// If we have successful results, get a streaming follow-up response
		if (toolResults.some((r) => !r.error)) {
			// Set status to summarizing
			setStatus("summarizing");

			try {
				// Format tool results for AI
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

				// Create a streaming follow-up message
				const followUpMessageId = `assistant-followup-${Date.now()}`;
				let followUpContent = "";

				// Add placeholder message for streaming
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

				// Build messages for follow-up (system prompt injected server-side)
				const followUpMessages = [
					...openaiClient.convertMessagesToOpenAI(previousMessages.slice(0, -1)),
					{
						role: "user",
						content: `Here are the results from the tool execution:\n\n${toolResultsSummary}\n\nPlease provide a brief, helpful summary of what was done for the user. Be concise.`,
					},
				];

				// Stream the follow-up response (no tools for summary)
				await openaiClient.createStreamingCompletion(
					{
						model: "gpt-4o-mini",
						messages: followUpMessages,
						tools: [], // Explicitly no tools for follow-up
						temperature: 0.7,
						max_tokens: 500,
					},
					// onChunk
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
					// onComplete
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
					// onError
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
			// No successful results, reset state
			setStatus(null);
			setIsLoading(false);
		}
	};

	/**
	 * Start a new chat session
	 */
	const handleNewChat = async () => {
		// Abort any ongoing requests
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		// Clear state
		setIsLoading(false);
		setStatus(null);
		setError(null);
		setMessages([]);
		setHasGlobalStylesChanges(false);
		originalGlobalStylesRef.current = null; // Reset original state tracking

		// Generate new session ID
		const newSessionId = generateSessionId();
		setSessionId(newSessionId);

		// Clear localStorage
		clearChatData();
		saveSessionId(newSessionId);

		// Reconnect MCP if needed
		if (mcpConnectionStatus !== "connected") {
			await initializeMCP();
		}
	};

	/**
	 * Accept changes - trigger WordPress save
	 */
	const handleAcceptChanges = async () => {
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

				// Reset the original state ref since changes are now committed
				originalGlobalStylesRef.current = null;
			} catch (saveError) {
				console.error("Error saving global styles:", saveError);
			}
		}

		// Trigger WordPress save/publish
		if (savePost) {
			savePost();
		}
	};

	/**
	 * Decline changes - restore to initial state
	 */
	const handleDeclineChanges = async () => {
		// Find the first message with undo data
		const firstActionMessage = messages.find((msg) => msg.hasActions && msg.undoData);

		if (!firstActionMessage || !firstActionMessage.undoData) {
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

			// Reset global styles changes flag and original state ref
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

		// Update any streaming messages to complete
		setMessages((prev) =>
			prev.map((msg) =>
				msg.isStreaming
					? {
							...msg,
							isStreaming: false,
						}
					: msg
			)
		);

		setIsLoading(false);
		setStatus(null);
		setError(null);
	};

	/**
	 * Refresh MCP connection
	 */
	const refreshMCPConnection = async () => {
		if (mcpClient.isConnected()) {
			await mcpClient.disconnect();
		}
		setMcpConnectionStatus("disconnected");
		await initializeMCP();
	};

	return {
		messages,
		isLoading,
		conversationId: sessionId, // Alias for backward compatibility
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
		refreshMCPConnection,
	};
};

export default useChat;
