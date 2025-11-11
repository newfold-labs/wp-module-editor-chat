/**
 * WordPress dependencies
 */
import { useMemo } from "@wordpress/element";
import { Button } from "@wordpress/components";

/**
 * External dependencies
 */
import { Check, X } from "lucide-react";

/**
 * Internal dependencies
 */
import { containsHtml, sanitizeHtml } from "../../utils/sanitizeHtml";
import UserAvatar from "../ui/UserAvatar";

/**
 * ChatMessage Component
 *
 * Displays a single message in the chat with appropriate styling and avatar.
 *
 * @param {Object}   props                    - The component props.
 * @param {string}   props.message            - The message content to display.
 * @param {string}   [props.type="assistant"] - The message type ("user" or "assistant").
 * @param {boolean}  [props.hasActions=false] - Whether the message has executed actions.
 * @param {number}   props.messageIndex       - The index of this message in the messages array.
 * @param {Function} props.onHideActions      - Callback to hide action buttons.
 * @return {JSX.Element} The ChatMessage component.
 */
const ChatMessage = ({
	message,
	type = "assistant",
	hasActions = false,
	messageIndex,
	onHideActions,
}) => {
	const isUser = type === "user";

	const handleAccept = () => {
		// eslint-disable-next-line no-console
		console.log("Accept button clicked");
		if (onHideActions) {
			onHideActions(messageIndex);
		}
	};

	const handleDecline = () => {
		// eslint-disable-next-line no-console
		console.log("Decline button clicked");
		if (onHideActions) {
			onHideActions(messageIndex);
		}
	};

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
			{isUser && <UserAvatar width={32} height={32} />}
			{!isUser && hasActions && (
				<div className="nfd-editor-chat-message__actions">
					<Button
						className="nfd-editor-chat-message__action-button nfd-editor-chat-message__action-button--accept"
						onClick={handleAccept}
					>
						<Check size={14} />
						Accept
					</Button>
					<Button
						className="nfd-editor-chat-message__action-button nfd-editor-chat-message__action-button--decline"
						onClick={handleDecline}
					>
						<X size={14} />
						Decline
					</Button>
				</div>
			)}
		</div>
	);
};

export default ChatMessage;
