/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies
 */
import { ReactComponent as SparksIcon } from "../svg/sparks.svg";

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat
 * - User messages: grey bubble, aligned right
 * - AI messages: plain text on white background, aligned left
 */
const ChatMessage = ({ message, type = "assistant" }) => {
	const isUser = type === "user";

	return (
		<div className={`nfd-chat-message nfd-chat-message--${type}`}>
			{!isUser && (
				<div className="nfd-chat-message__avatar">
					<SparksIcon width={20} height={20} />
				</div>
			)}
			<div className="nfd-chat-message__content">{message}</div>
			{isUser && (
				<div className="nfd-chat-message__avatar nfd-chat-message__avatar--user">
					<span>A</span>
				</div>
			)}
		</div>
	);
};

export default ChatMessage;
