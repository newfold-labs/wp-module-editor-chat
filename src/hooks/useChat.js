/* eslint-disable no-undef */
/**
 * WordPress dependencies
 */
import { useEffect, useState, useRef } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { useDispatch, useSelect } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";

/**
 * Internal dependencies
 */
import { sendMessage, createNewConversation, checkStatus } from "../services/chatApi";
import actionExecutor from "../services/actionExecutor";
import { simpleHash } from "../utils/helpers";

/**
 * Get site-specific localStorage keys for chat persistence
 * Uses the site URL to ensure each site has its own isolated chat history
 *
 * @return {Object} Storage keys object with site-specific keys
 */
const getStorageKeys = () => {
	// Hash the site origin to create a unique, compact identifier
	const siteId = simpleHash(window.nfdEditorChat.homeUrl);

	return {
		CONVERSATION_ID: `nfd-editor-chat-conversation-id-${siteId}`,
		MESSAGES: `nfd-editor-chat-messages-${siteId}`,
	};
};

/**
 * Load conversation ID from localStorage
 *
 * @return {string|null} The conversation ID or null
 */
const loadConversationId = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		return localStorage.getItem(STORAGE_KEYS.CONVERSATION_ID);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn("Failed to load conversation ID from localStorage:", error);
		return null;
	}
};

/**
 * Save conversation ID to localStorage
 *
 * @param {string} conversationId The conversation ID to save
 */
const saveConversationId = (conversationId) => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		if (conversationId) {
			localStorage.setItem(STORAGE_KEYS.CONVERSATION_ID, conversationId);
		} else {
			localStorage.removeItem(STORAGE_KEYS.CONVERSATION_ID);
		}
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn("Failed to save conversation ID to localStorage:", error);
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
			return messages.map((msg) => {
				const { hasActions, undoData, ...rest } = msg;
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
		localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(messages));
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
		localStorage.removeItem(STORAGE_KEYS.CONVERSATION_ID);
		localStorage.removeItem(STORAGE_KEYS.MESSAGES);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.warn("Failed to clear chat data from localStorage:", error);
	}
};

/**
 * Custom hook for managing chat functionality
 *
 * @return {Object} Chat state and handlers
 */
const useChat = () => {
	// Initialize state from localStorage immediately
	const savedConversationId = loadConversationId();
	const savedMessages = loadMessages();

	const [messages, setMessages] = useState(savedMessages || []);
	const [isLoading, setIsLoading] = useState(false);
	const [conversationId, setConversationId] = useState(savedConversationId);
	const [error, setError] = useState(null);
	const [status, setStatus] = useState(null); // 'received', 'generating', 'completed', 'failed'
	const [isSaving, setIsSaving] = useState(false);
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);
	const hasInitializedRef = useRef(false);
	const pollingIntervalRef = useRef(null);
	const pollingTimeoutRef = useRef(null);
	const pollingStartTimeRef = useRef(null);

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

	// Create a new conversation only once on mount if there's nothing in localStorage
	useEffect(() => {
		// Only initialize once per component mount
		if (hasInitializedRef.current) {
			return;
		}

		hasInitializedRef.current = true;

		// Check localStorage directly to avoid dependency issues
		// Only create a new conversation if we don't have one in localStorage
		const storedConversationId = loadConversationId();
		if (!storedConversationId) {
			const initializeConversation = async () => {
				try {
					const response = await createNewConversation();
					if (response.conversationId) {
						setConversationId(response.conversationId);
					}
				} catch (err) {
					// eslint-disable-next-line no-console
					console.error("Failed to initialize conversation:", err);
				}
			};

			initializeConversation();
		}
	}, []); // Empty dependency array - only run once on mount

	// Save conversation ID when it changes
	useEffect(() => {
		saveConversationId(conversationId);
	}, [conversationId]);

	// Save messages when they change
	useEffect(() => {
		if (messages.length > 0) {
			saveMessages(messages);
		}
	}, [messages]);

	// Cleanup polling interval and timeout on unmount
	useEffect(() => {
		return () => {
			if (pollingIntervalRef.current) {
				clearInterval(pollingIntervalRef.current);
				pollingIntervalRef.current = null;
			}
			if (pollingTimeoutRef.current) {
				clearTimeout(pollingTimeoutRef.current);
				pollingTimeoutRef.current = null;
			}
		};
	}, []);

	const handleSendMessage = async (messageContent) => {
		// Clear any previous errors and status
		setError(null);
		setStatus(null);

		// Check if we have a conversation ID
		if (!conversationId) {
			setError(
				__(
					"No active conversation. Please refresh the page and try again.",
					"wp-module-editor-chat"
				)
			);
			return;
		}

		// Add user message
		const userMessage = {
			type: "user",
			content: messageContent,
		};
		setMessages((prev) => [...prev, userMessage]);
		setIsLoading(true);
		setStatus("received");

		try {
			// Send message to API with existing conversation
			// This now returns message_id immediately
			const response = await sendMessage(conversationId, messageContent);

			if (!response.message_id) {
				// eslint-disable-next-line no-console
				console.error("No message_id in response:", response);
				throw new Error("No message_id received from API");
			}

			// Start polling for status
			const messageId = response.message_id;
			// Call polling in next tick to ensure state updates are processed
			setTimeout(() => {
				pollMessageStatus(messageId);
			}, 0);
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("Error sending message:", err);

			// Set error state instead of adding error message to chat
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
	 * Stop polling and cleanup
	 */
	const stopPolling = () => {
		if (pollingIntervalRef.current) {
			clearInterval(pollingIntervalRef.current);
			pollingIntervalRef.current = null;
		}
		if (pollingTimeoutRef.current) {
			clearTimeout(pollingTimeoutRef.current);
			pollingTimeoutRef.current = null;
		}
		pollingStartTimeRef.current = null;
	};

	/**
	 * Poll the status endpoint every 4 seconds, with a maximum of 2 minutes
	 *
	 * @param {string} messageId - The message ID to check status for
	 */
	const pollMessageStatus = (messageId) => {
		// Clear any existing polling interval and timeout
		stopPolling();

		// Record start time
		pollingStartTimeRef.current = Date.now();
		const MAX_POLLING_TIME = 120000; // 2 minutes in milliseconds
		const POLLING_INTERVAL = 4000; // 4 seconds in milliseconds

		// Poll immediately, then every 4 seconds
		const checkStatusNow = async () => {
			try {
				// Check if we've exceeded the maximum polling time
				const elapsedTime = Date.now() - pollingStartTimeRef.current;
				if (elapsedTime >= MAX_POLLING_TIME) {
					stopPolling();
					setError(
						__(
							"The request is taking longer than expected. Please try again or refresh the page.",
							"wp-module-editor-chat"
						)
					);
					setIsLoading(false);
					setStatus(null);
					return;
				}

				const statusResponse = await checkStatus(messageId);

				const currentStatus = statusResponse.status;

				setStatus(currentStatus);

				if (currentStatus === "completed") {
					stopPolling();

					// Process the completed response
					if (statusResponse.data) {
						const data = statusResponse.data;

						// Extract assistant message
						let assistantMessage = "I received your message.";
						if (data.chat?.current_message?.assistant) {
							assistantMessage = data.chat.current_message.assistant;
						}

						// Execute actions if present
						let hasExecutedActions = false;
						let undoData = null;
						if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
							try {
								// Check if there's already a pending action (existing message with hasActions)
								const hasPendingAction = messages.some((msg) => msg.hasActions);

								if (hasPendingAction) {
									// There's already a pending action - reuse the initial undo data
									const firstActionMessage = messages.find((msg) => msg.hasActions && msg.undoData);

									// Normalize undo data structure (handle both old array format and new object format)
									if (firstActionMessage && firstActionMessage.undoData) {
										if (Array.isArray(firstActionMessage.undoData)) {
											// Convert old array format to new object format
											undoData = {
												blocks: firstActionMessage.undoData,
												globalStyles: null,
											};
										} else {
											// Already in new object format
											undoData = firstActionMessage.undoData;
										}
									} else {
										undoData = null;
									}

									// Execute the new action (this will modify the already-modified content)
									await actionExecutor.executeActions(data.actions);
									hasExecutedActions = true;

									// Check if any action was change_site_colors
									const hasColorChanges = data.actions.some(
										(action) => action.action === "change_site_colors"
									);
									if (hasColorChanges) {
										setHasGlobalStylesChanges(true);
									}
								} else {
									// This is the FIRST action in a sequence
									// We need to capture the initial state before any modifications

									// Execute actions and capture the initial state
									const actionResult = await actionExecutor.executeActions(data.actions);
									hasExecutedActions = true;

									// Check if any action was change_site_colors
									const hasColorChanges = data.actions.some(
										(action) => action.action === "change_site_colors"
									);
									if (hasColorChanges) {
										setHasGlobalStylesChanges(true);
									}

									// Extract the INITIAL undo data (state before this first action)
									// Structure: { blocks: [], globalStyles: { originalStyles, globalStylesId } }
									undoData = {
										blocks: [],
										globalStyles: null,
									};

									if (actionResult.results && actionResult.results.length > 0) {
										actionResult.results.forEach((result) => {
											// Handle block-based actions (edit_content)
											if (result.results && Array.isArray(result.results)) {
												result.results.forEach((blockResult) => {
													if (blockResult.originalBlock) {
														undoData.blocks.push(blockResult.originalBlock);
													}
												});
											}

											// Handle global styles actions (change_site_colors)
											if (
												result.type === "change_site_colors" &&
												result.originalStyles &&
												result.globalStylesId
											) {
												undoData.globalStyles = {
													originalStyles: result.originalStyles,
													globalStylesId: result.globalStylesId,
												};
											}
										});
									}
								}
							} catch (actionError) {
								// eslint-disable-next-line no-console
								console.error("Error executing actions:", actionError);
							}
						}

						// Add AI response with action information
						const aiMessage = {
							type: "assistant",
							content: assistantMessage,
							hasActions: hasExecutedActions,
							undoData, // Store undo data (either new or reused from first message)
						};
						setMessages((prev) => [...prev, aiMessage]);
					}

					setIsLoading(false);
					setStatus(null);
				} else if (currentStatus === "failed") {
					stopPolling();

					setError(
						__(
							"Sorry, I encountered an error processing your request. Please try again.",
							"wp-module-editor-chat"
						)
					);
					setIsLoading(false);
					setStatus(null);
				}
				// For 'received' and 'generating', continue polling
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error("Error checking status:", err);

				// Check if we've exceeded the maximum polling time even on error
				const elapsedTime = Date.now() - pollingStartTimeRef.current;
				if (elapsedTime >= MAX_POLLING_TIME) {
					stopPolling();
					setError(
						__(
							"The request is taking longer than expected. Please try again or refresh the page.",
							"wp-module-editor-chat"
						)
					);
					setIsLoading(false);
					setStatus(null);
				}
				// Continue polling even on error (might be temporary)
			}
		};

		// Check immediately
		checkStatusNow();

		// Then poll every 4 seconds
		pollingIntervalRef.current = setInterval(checkStatusNow, POLLING_INTERVAL);

		// Set timeout to stop polling after 2 minutes
		pollingTimeoutRef.current = setTimeout(() => {
			stopPolling();
			setError(
				__(
					"The request is taking longer than expected. Please try again or refresh the page.",
					"wp-module-editor-chat"
				)
			);
			setIsLoading(false);
			setStatus(null);
		}, MAX_POLLING_TIME);
	};

	const handleNewChat = async () => {
		// Stop any active polling/requests
		stopPolling();

		// Clear loading and status states
		setIsLoading(false);
		setStatus(null);

		// Reset messages and conversation ID to show welcome screen
		setMessages([]);
		setConversationId(null);
		setError(null);
		// Clear localStorage data
		clearChatData();

		// Create a new conversation immediately
		try {
			const response = await createNewConversation();
			if (response.conversationId) {
				setConversationId(response.conversationId);
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("Failed to create new conversation:", err);
		}
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
		// Stop polling
		stopPolling();

		// Clear loading state and status
		setIsLoading(false);
		setStatus(null);
		setError(null);
	};

	return {
		messages,
		isLoading,
		conversationId,
		error,
		status,
		isSaving,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
	};
};

export default useChat;
