/**
 * WordPress dependencies
 */
import { useRef, useEffect } from "@wordpress/element";

/**
 * Internal dependencies
 */
import ChatMessage from "./ChatMessage";
import TypingIndicator from "../ui/TypingIndicator";

/**
 * ChatMessages Component
 *
 * Scrollable container for all chat messages
 * Auto-scrolls to bottom when new messages arrive
 *
 * @param {Object}  props           - The component props.
 * @param {Array}   props.messages  - The messages to display.
 * @param {boolean} props.isLoading - Whether the AI is currently generating a response.
 * @return {JSX.Element} The ChatMessages component.
 */
const ChatMessages = ({ messages = [], isLoading = false }) => {
	const messagesEndRef = useRef(null);

	// Scroll to bottom when new messages arrive or loading state changes
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isLoading]);

	return (
		<div className="nfd-editor-chat-messages">
			{messages.length &&
				messages.map((msg, index) => (
					<ChatMessage key={index} message={msg.content} type={msg.type} />
				))}
			{isLoading && <TypingIndicator />}
			<div ref={messagesEndRef} />
		</div>
	);
};

export default ChatMessages;
