/* eslint-disable no-undef */
/**
 * WordPress dependencies
 */
import { useEffect, useState, useRef } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import { sendMessage, createNewConversation, checkStatus } from "../services/chatApi";
import actionExecutor from "../services/actionExecutor";

/**
 * LocalStorage keys for chat persistence
 */
const STORAGE_KEYS = {
	CONVERSATION_ID: "nfd-editor-chat-conversation-id",
	MESSAGES: "nfd-editor-chat-messages",
};

/**
 * Load conversation ID from localStorage
 *
 * @return {string|null} The conversation ID or null
 */
const loadConversationId = () => {
	try {
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
		const stored = localStorage.getItem(STORAGE_KEYS.MESSAGES);
		if (stored) {
			const messages = JSON.parse(stored);
			// Remove hasActions flag from loaded messages (actions should only show once)
			return messages.map((msg) => {
				const { hasActions, ...rest } = msg;
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
	const hasInitializedRef = useRef(false);
	const pollingIntervalRef = useRef(null);
	const pollingTimeoutRef = useRef(null);
	const pollingStartTimeRef = useRef(null);

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
						if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
							try {
								const actionResult = await actionExecutor.executeActions(data.actions);
								hasExecutedActions = true;
								// eslint-disable-next-line no-console
								console.log("Actions executed:", actionResult);
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
				} else {
					// eslint-disable-next-line no-console
					console.log("Status is", currentStatus, "- continuing to poll");
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
	 * Hide action buttons for a specific message
	 *
	 * @param {number} messageIndex - The index of the message to update
	 */
	const hideMessageActions = (messageIndex) => {
		setMessages((prev) =>
			prev.map((msg, index) => {
				if (index === messageIndex) {
					const { hasActions, ...rest } = msg;
					return rest;
				}
				return msg;
			})
		);
	};

	return {
		messages,
		isLoading,
		conversationId,
		error,
		status,
		handleSendMessage,
		handleNewChat,
		hideMessageActions,
	};
};

export default useChat;
