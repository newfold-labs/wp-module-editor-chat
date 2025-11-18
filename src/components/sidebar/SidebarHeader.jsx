/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Plus, Sparkles } from "lucide-react";

/**
 * SidebarHeader Component
 *
 * Displays the sidebar header with title and action buttons.
 *
 * @param {Object}   props           Component props
 * @param {Function} props.onNewChat Function to call when new chat is requested
 * @return {JSX.Element} The SidebarHeader component.
 */
const SidebarHeader = ({ onNewChat }) => {
	return (
		<div className="nfd-editor-chat-sidebar__header-content">
			<div className="interface-complementary-area-header__title">
				<Sparkles width={15} height={15} />
				<h2>
					{__("Blu Chat", "wp-module-editor-chat")}
					<span className="nfd-editor-chat-sidebar__beta-badge">Beta</span>
				</h2>
			</div>
			{onNewChat && (
				<div className="nfd-editor-chat-sidebar__header-actions">
					<Button
						icon={<Plus width={16} height={16} />}
						label={__("New chat", "wp-module-editor-chat")}
						onClick={onNewChat}
						className="nfd-editor-chat-sidebar__new-chat"
					/>
				</div>
			)}
		</div>
	);
};

export default SidebarHeader;
