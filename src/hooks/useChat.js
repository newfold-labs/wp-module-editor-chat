/* eslint-disable no-undef */
/**
 * WordPress dependencies
 */
import { useEffect, useState, useRef } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import { sendMessage, createNewConversation } from "../services/chatApi";

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
		return stored ? JSON.parse(stored) : [];
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
	const hasInitializedRef = useRef(false);

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
				} catch (error) {
					// eslint-disable-next-line no-console
					console.error("Failed to initialize conversation:", error);
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

	const handleSendMessage = async (messageContent) => {
		// Clear any previous errors
		setError(null);

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

		try {
			// Send message to API with existing conversation
			const response = await sendMessage(conversationId, messageContent);

			// Add AI response
			const aiMessage = {
				type: "assistant",
				content: response.message || response.response || "I received your message.",
			};
			setMessages((prev) => [...prev, aiMessage]);
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
		} finally {
			setIsLoading(false);
		}
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
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("Failed to create new conversation:", error);
		}
	};

	return {
		messages,
		isLoading,
		conversationId,
		error,
		handleSendMessage,
		handleNewChat,
	};
};

export default useChat;
