/**
 * WordPress dependencies
 */
import { useEffect, useRef } from "@wordpress/element";

/**
 * Internal dependencies
 */
import ErrorAlert from "../ui/ErrorAlert";
import TypingIndicator from "../ui/TypingIndicator";
import ChatMessage from "./ChatMessage";

/**
 * ChatMessages Component
 *
 * Scrollable container for all chat messages
 * Auto-scrolls to bottom when new messages arrive
 *
 * @param {Object}   props              - The component props.
 * @param {Array}    props.messages     - The messages to display.
 * @param {boolean}  props.isLoading    - Whether the AI is currently generating a response.
 * @param {string}   props.error        - Error message to display (optional).
 * @param {string}   props.status       - The current status ('received', 'generating', etc.).
 * @param {Function} props.onHideActions - Callback to hide action buttons for a message.
 * @return {JSX.Element} The ChatMessages component.
 */
const ChatMessages = ({ messages = [], isLoading = false, error = null, status = null, onHideActions }) => {
	const messagesEndRef = useRef(null);

	// Scroll to bottom when new messages arrive or loading state changes
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isLoading]);

	return (
		<div className="nfd-editor-chat-messages">
			{messages.length &&
				messages.map((msg, index) => (
					<ChatMessage
						key={index}
						message={msg.content}
						type={msg.type}
						hasActions={msg.hasActions}
						messageIndex={index}
						onHideActions={onHideActions}
					/>
				))}
			{error && <ErrorAlert message={error} />}
			{isLoading && <TypingIndicator status={status} />}
			<div ref={messagesEndRef} />
		</div>
	);
};

export default ChatMessages;
