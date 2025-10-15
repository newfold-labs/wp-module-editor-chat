/**
 * WordPress dependencies
 */
import { useRef, useEffect } from "@wordpress/element";

/**
 * Internal dependencies
 */
import ChatMessage from "./ChatMessage";

/**
 * ChatMessages Component
 *
 * Scrollable container for all chat messages
 * Auto-scrolls to bottom when new messages arrive
 *
 * @param props          - The component props.
 * @param props.messages - The messages to display.
 */
const ChatMessages = ({ messages = [] }) => {
	const messagesEndRef = useRef(null);

	// Scroll to bottom when new messages arrive
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	return (
		<div className="nfd-chat-messages">
			{messages.length &&
				messages.map((msg, index) => (
					<ChatMessage key={index} message={msg.content} type={msg.type} />
				))}
			<div ref={messagesEndRef} />
		</div>
	);
};

export default ChatMessages;
