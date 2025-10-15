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

	const handleSendMessage = async (messageContent) => {
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
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("Error sending message:", error);

			// Add error message
			const errorMessage = {
				type: "assistant",
				content: __(
					"Sorry, I encountered an error processing your request. Please try again.",
					"wp-module-editor-chat"
				),
			};
			setMessages((prev) => [...prev, errorMessage]);
		} finally {
			setIsLoading(false);
		}
	};

	const handleNewChat = () => {
		// Reset messages and conversation ID to show welcome screen
		setMessages([]);
		setConversationId(null);
	};

	return {
		messages,
		isLoading,
		conversationId,
		handleSendMessage,
		handleNewChat,
	};
};

export default useChat;
