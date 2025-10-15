/**
 * WordPress dependencies
 */
import { useSelect } from "@wordpress/data";

/**
 * Internal dependencies
 */
import AIAvatar from "./AIAvatar";

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

	// Get current user data
	const currentUser = useSelect((select) => {
		const { getCurrentUser } = select("core");
		return getCurrentUser();
	}, []);

	// Get the first letter of the user's name, fallback to "U" if no name
	const getUserInitial = () => {
		if (!currentUser) {
			return "U";
		}
		const name = currentUser.name || currentUser.display_name || currentUser.user_login || "";
		return name.charAt(0).toUpperCase() || "U";
	};

	// Get WordPress user avatar URL
	const getUserAvatar = () => {
		if (!currentUser) {
			return null;
		}
		// WordPress provides avatar URLs in different formats
		return currentUser.avatar_urls?.[96] || currentUser.avatar_urls?.[48] || null;
	};

	return (
		<div className={`nfd-chat-message nfd-chat-message--${type}`}>
			{!isUser && <AIAvatar width={32} height={32} />}
			<div className="nfd-chat-message__content">{message}</div>
			{isUser && (
				<div className="nfd-chat-message__avatar nfd-chat-message__avatar--user">
					{getUserAvatar() ? (
						<img
							src={getUserAvatar()}
							alt="User avatar"
							className="nfd-chat-message__avatar-image"
						/>
					) : (
						<span>{getUserInitial()}</span>
					)}
				</div>
			)}
		</div>
	);
};

export default ChatMessage;
