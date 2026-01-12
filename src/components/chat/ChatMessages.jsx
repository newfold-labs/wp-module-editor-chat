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
import PermissionDialog from "./PermissionDialog";

/**
 * ChatMessages Component
 *
 * Scrollable container for all chat messages with tool call and permission support.
 * Auto-scrolls to bottom when new messages arrive.
 *
 * @param {Object}   props                         - The component props.
 * @param {Array}    props.messages                - The messages to display.
 * @param {boolean}  props.isLoading               - Whether the AI is currently generating a response.
 * @param {string}   props.error                   - Error message to display (optional).
 * @param {string}   props.status                  - The current status ('streaming', 'tool_calling', etc.).
 * @param {Object}   props.pendingToolPermission   - Pending tool permission request (optional).
 * @param {Function} props.onApprovePermission     - Callback when user approves permission.
 * @param {Function} props.onDenyPermission        - Callback when user denies permission.
 * @return {JSX.Element} The ChatMessages component.
 */
const ChatMessages = ({
	messages = [],
	isLoading = false,
	error = null,
	status = null,
	pendingToolPermission = null,
	onApprovePermission,
	onDenyPermission,
}) => {
	const messagesEndRef = useRef(null);

	// Scroll to bottom when new messages arrive or loading state changes
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages, isLoading, pendingToolPermission]);

	const isExecutingTools = status === "tool_calling";

	return (
		<div className="nfd-editor-chat-messages">
			{messages.length > 0 &&
				messages.map((msg, index) => (
					<ChatMessage
						key={msg.id || index}
						message={msg.content}
						type={msg.type}
						toolCalls={msg.toolCalls}
						toolResults={msg.toolResults}
						isStreaming={msg.isStreaming}
						isExecutingTools={isExecutingTools && index === messages.length - 1}
					/>
				))}

			{/* Permission dialog for destructive tool calls */}
			{pendingToolPermission && (
				<PermissionDialog
					toolCalls={pendingToolPermission.toolCalls}
					onApprove={onApprovePermission}
					onDeny={onDenyPermission}
				/>
			)}

			{error && <ErrorAlert message={error} />}

			{/* Show typing indicator only when streaming without a message placeholder */}
			{isLoading && !messages.some((m) => m.isStreaming) && status !== "awaiting_permission" && (
				<TypingIndicator status={status} />
			)}

			<div ref={messagesEndRef} />
		</div>
	);
};

export default ChatMessages;
