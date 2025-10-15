/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Maximize2, MessageSquarePlus } from "lucide-react";

/**
 * SidebarHeader Component
 *
 * Displays the sidebar header with title and action buttons.
 *
 * @param {Object}   props           - The component props.
 * @param {Function} props.onNewChat - The function to call when new chat is clicked.
 * @param {Function} props.onExpand  - The function to call when expand is clicked.
 * @return {JSX.Element} The SidebarHeader component.
 */
const SidebarHeader = ({ onNewChat, onExpand }) => {
	return (
		<div className="nfd-editor-chat-sidebar__header-content">
			<h2 className="interface-complementary-area-header__title">
				{__("AI Chat Editor", "wp-module-editor-chat")}
			</h2>
			<div className="nfd-editor-chat-sidebar__header-actions">
				<Button
					icon={<MessageSquarePlus width={16} height={16} />}
					label={__("Start new chat", "wp-module-editor-chat")}
					onClick={onNewChat}
					className="nfd-editor-chat-sidebar__new-chat"
				/>
				<Button
					icon={<Maximize2 width={16} height={16} />}
					label={__("Open in new window", "wp-module-editor-chat")}
					onClick={onExpand}
					className="nfd-editor-chat-sidebar__expand"
				/>
			</div>
		</div>
	);
};

export default SidebarHeader;
