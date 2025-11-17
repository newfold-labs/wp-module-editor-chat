/**
 * WordPress dependencies
 */
import { useMemo } from "@wordpress/element";

/**
 * Internal dependencies
 */
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";

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

	// Sanitize and prepare content for rendering
	const sanitizedContent = useMemo(() => {
		if (!message) {
			return "";
		}

		// For user messages, always render as plain text
		if (isUser) {
			return message;
		}

		// For AI messages, check if it contains HTML
		if (containsHtml(message)) {
			return sanitizeHtml(message);
		}

		// Plain text messages
		return message;
	}, [message, isUser]);

	// Determine if we should render as HTML
	const shouldRenderAsHtml = !isUser && containsHtml(message);

	return (
		<div className={`nfd-editor-chat-message nfd-editor-chat-message--${type}`}>
			{/* {!isUser && <AILogo width={32} height={32} />} */}
			{shouldRenderAsHtml ? (
				<div
					className="nfd-editor-chat-message__content"
					dangerouslySetInnerHTML={{ __html: sanitizedContent }}
				/>
			) : (
				<div className="nfd-editor-chat-message__content">{sanitizedContent}</div>
			)}
		</div>
	);
};

export default ChatMessage;
