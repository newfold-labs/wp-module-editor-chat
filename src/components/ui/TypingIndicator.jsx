/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * TypingIndicator Component
 *
 * Displays an animated typing indicator with dots and a loading message.
 * Shows the current status if provided.
 *
 * @param {Object} props        - The component props.
 * @param {string} props.status - The current status ('streaming', 'tool_calling', etc.).
 * @return {JSX.Element} The TypingIndicator component.
 */
const TypingIndicator = ({ status = null }) => {
	// Get status text based on status value
	const getStatusText = () => {
		switch (status) {
			case "connecting":
				return __("Connecting…", "wp-module-editor-chat");
			case "streaming":
				return __("Generating response…", "wp-module-editor-chat");
			case "tool_calling":
				return __("Executing actions…", "wp-module-editor-chat");
			case "awaiting_permission":
				return __("Waiting for permission…", "wp-module-editor-chat");
			case "received":
				return __("Message received…", "wp-module-editor-chat");
			case "generating":
				return __("Generating response…", "wp-module-editor-chat");
			case "completed":
				return __("Processing…", "wp-module-editor-chat");
			case "failed":
				return __("Error occurred", "wp-module-editor-chat");
			default:
				return __("Thinking…", "wp-module-editor-chat");
		}
	};

	return (
		<div className="nfd-editor-chat-message nfd-editor-chat-message--assistant">
			<div className="nfd-editor-chat-message__content">
				<div className="nfd-editor-chat-typing-indicator">
					<div className="nfd-editor-chat-typing-indicator__loader"></div>
					<div className="nfd-editor-chat-typing-indicator__status">{getStatusText()}</div>
				</div>
			</div>
		</div>
	);
};

export default TypingIndicator;
