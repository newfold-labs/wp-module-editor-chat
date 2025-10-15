/**
 * WordPress dependencies
 */
import { useState } from "@wordpress/element";

/**
 * Custom hook for managing chat functionality
 *
 * @return {Object} Chat state and handlers
 */
const useChat = () => {
	const [messages, setMessages] = useState([]);
	const [isLoading, setIsLoading] = useState(false);

	const handleSendMessage = async (messageContent) => {
		// Add user message
		const userMessage = {
			type: "user",
			content: messageContent,
		};
		setMessages((prev) => [...prev, userMessage]);
		setIsLoading(true);

		// TODO: Replace with actual API call
		// Simulate AI response
		setTimeout(() => {
			const aiMessage = {
				type: "assistant",
				content: "This is a placeholder response. The AI functionality will be implemented soon.",
			};
			setMessages((prev) => [...prev, aiMessage]);
			setIsLoading(false);
		}, 1000);
	};

	const handleNewChat = () => {
		// Reset messages to empty array to show welcome screen
		setMessages([]);
	};

	return {
		messages,
		isLoading,
		handleSendMessage,
		handleNewChat,
	};
};

export default useChat;
