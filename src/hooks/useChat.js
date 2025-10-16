/**
 * WordPress dependencies
 */
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import { sendMessage } from "../services/chatApi";

/**
 * Custom hook for managing chat functionality
 *
 * @return {Object} Chat state and handlers
 */
const useChat = () => {
	const [messages, setMessages] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [conversationId, setConversationId] = useState(null);
	const [error, setError] = useState(null);

	const handleSendMessage = async (messageContent) => {
		// Clear any previous errors
		setError(null);

		// Add user message
		const userMessage = {
			type: "user",
			content: messageContent,
		};
		setMessages((prev) => [...prev, userMessage]);
		setIsLoading(true);

		try {
			// Send message to API with context (will create conversation if needed)
			const response = await sendMessage(conversationId, messageContent);

			// Update conversation ID if this was the first message
			if (response.conversationId && !conversationId) {
				setConversationId(response.conversationId);
			}

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

	const handleNewChat = () => {
		// Reset messages and conversation ID to show welcome screen
		setMessages([]);
		setConversationId(null);
		setError(null);
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
