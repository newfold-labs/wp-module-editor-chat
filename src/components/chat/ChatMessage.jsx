/**
 * WordPress dependencies
 */
import { useMemo } from "@wordpress/element";

/**
 * Internal dependencies
 */
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";
import { containsMarkdown, parseMarkdown } from "../../utils/markdownParser";

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat with appropriate styling and avatar.
 * Supports HTML and Markdown rendering for assistant messages.
 *
 * @param {Object} props                    - The component props.
 * @param {string} props.message            - The message content to display.
 * @param {string} [props.type="assistant"] - The message type ("user" or "assistant").
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({ message, type = "assistant" }) => {
	const isUser = type === "user";

	// Sanitize and prepare content for rendering
	const { content, isRichContent } = useMemo(() => {
		if (!message) {
			return { content: "", isRichContent: false };
		}

		// For user messages, always render as plain text
		if (isUser) {
			return { content: message, isRichContent: false };
		}

		// For AI messages, check if it contains HTML first
		if (containsHtml(message)) {
			return { content: sanitizeHtml(message), isRichContent: true };
		}

		// Check if it contains Markdown
		if (containsMarkdown(message)) {
			const parsed = parseMarkdown(message);
			return { content: sanitizeHtml(parsed), isRichContent: true };
		}

		// Plain text messages
		return { content: message, isRichContent: false };
	}, [message, isUser]);

	// Don't render empty messages
	if (!content) {
		return null;
	}

	return (
		<div className={`nfd-editor-chat-message nfd-editor-chat-message--${type}`}>
			{isRichContent ? (
				<div
					className="nfd-editor-chat-message__content nfd-editor-chat-message__content--rich"
					dangerouslySetInnerHTML={{ __html: content }}
				/>
			) : (
				<div className="nfd-editor-chat-message__content">{content}</div>
			)}
		</div>
	);
};

export default ChatMessage;
