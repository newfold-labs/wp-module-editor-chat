/**
 * WordPress dependencies
 */
import { useSelect } from "@wordpress/data";

/**
 * UserAvatar Component
 *
 * A reusable avatar component for users that displays either their WordPress profile picture
 * or their initial letter as a fallback.
 *
 * @param {Object} props        - The component props.
 * @param {number} props.width  - The width of the avatar (default: 32).
 * @param {number} props.height - The height of the avatar (default: 32).
 * @return {JSX.Element} The UserAvatar component.
 */
const UserAvatar = ({ width = 32, height = 32 }) => {
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
		<div
			className="nfd-editor-chat-message__avatar nfd-editor-chat-message__avatar--user"
			style={{ width, height }}
		>
			{getUserAvatar() ? (
				<img
					src={getUserAvatar()}
					alt="User avatar"
					className="nfd-editor-chat-message__avatar-image"
				/>
			) : (
				<span>{getUserInitial()}</span>
			)}
		</div>
	);
};

export default UserAvatar;
