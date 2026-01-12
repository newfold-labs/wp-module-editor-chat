/**
 * WordPress dependencies
 */
import { useMemo } from "@wordpress/element";

/**
 * External dependencies
 */
import { Loader2 } from "lucide-react";
import classnames from "classnames";

/**
 * Internal dependencies
 */
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";
import { ToolCallsList } from "./ToolCallDisplay";

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat with appropriate styling,
 * tool calls, and streaming indicator.
 *
 * @param {Object}  props                    - The component props.
 * @param {string}  props.message            - The message content to display.
 * @param {string}  [props.type="assistant"] - The message type ("user" or "assistant").
 * @param {Array}   [props.toolCalls]        - Array of tool calls (optional).
 * @param {Array}   [props.toolResults]      - Array of tool results (optional).
 * @param {boolean} [props.isStreaming]      - Whether this message is currently streaming.
 * @param {boolean} [props.isExecutingTools] - Whether tools are currently being executed.
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({
	message,
	type = "assistant",
	toolCalls,
	toolResults,
	isStreaming = false,
	isExecutingTools = false,
}) => {
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

	const hasToolCalls = toolCalls && toolCalls.length > 0;

	return (
		<div
			className={classnames("nfd-editor-chat-message", `nfd-editor-chat-message--${type}`, {
				"nfd-editor-chat-message--streaming": isStreaming,
				"nfd-editor-chat-message--has-tools": hasToolCalls,
			})}
		>
			{/* Message content */}
			{shouldRenderAsHtml ? (
				<div
					className="nfd-editor-chat-message__content"
					dangerouslySetInnerHTML={{ __html: sanitizedContent }}
				/>
			) : (
				<div className="nfd-editor-chat-message__content">
					{sanitizedContent}
					{isStreaming && !sanitizedContent && (
						<span className="nfd-editor-chat-message__typing">
							<Loader2 className="nfd-editor-chat-message__typing-icon" />
						</span>
					)}
				</div>
			)}

			{/* Streaming cursor indicator */}
			{isStreaming && sanitizedContent && <span className="nfd-editor-chat-message__cursor" />}

			{/* Tool calls display */}
			{hasToolCalls && (
				<div className="nfd-editor-chat-message__tools">
					<ToolCallsList
						toolCalls={toolCalls}
						toolResults={toolResults}
						isExecuting={isExecutingTools}
					/>
				</div>
			)}
		</div>
	);
};

export default ChatMessage;
