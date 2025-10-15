/**
 * Internal dependencies
 */
import AIAvatar from "../ui/AIAvatar";
import UserAvatar from "../ui/UserAvatar";

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat with appropriate styling and avatar.
 *
 * @param {Object} props                    - The component props.
 * @param {string} props.message            - The message content to display.
 * @param {string} [props.type="assistant"] - The message type ("user" or "assistant").
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({ message, type = "assistant" }) => {
	const isUser = type === "user";

	return (
		<div className={`nfd-editor-chat-message nfd-editor-chat-message--${type}`}>
			{!isUser && <AIAvatar width={32} height={32} />}
			<div className="nfd-editor-chat-message__content">{message}</div>
			{isUser && <UserAvatar width={32} height={32} />}
		</div>
	);
};

export default ChatMessage;
