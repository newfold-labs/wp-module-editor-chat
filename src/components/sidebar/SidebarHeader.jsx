/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Plus, History } from "lucide-react";

/**
 * SidebarHeader Component
 *
 * Displays the sidebar header with title and action buttons.
 *
 * @param {Object}   props               - The component props.
 * @param {Function} props.onNewChat     - The function to call when new chat is clicked.
 * @param {Function} props.onShowHistory - The function to call when show history is clicked.
 * @return {JSX.Element} The SidebarHeader component.
 */
const SidebarHeader = ({ onNewChat, onShowHistory }) => {
	return (
		<div className="nfd-editor-chat-sidebar__header-content">
			<h2 className="interface-complementary-area-header__title">
				{__("AI Chat Editor", "wp-module-editor-chat")}
			</h2>
			<div className="nfd-editor-chat-sidebar__header-actions">
				<Button
					icon={<Plus width={16} height={16} />}
					label={__("New chat", "wp-module-editor-chat")}
					onClick={onNewChat}
					className="nfd-editor-chat-sidebar__new-chat"
				/>
				<Button
					icon={<History width={16} height={16} />}
					label={__("View history", "wp-module-editor-chat")}
					onClick={onShowHistory}
					className="nfd-editor-chat-sidebar__history"
				/>
			</div>
		</div>
	);
};

export default SidebarHeader;
