/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */

/**
 * SidebarHeader Component
 *
 * Displays the sidebar header with title and action buttons.
 *
 * @return {JSX.Element} The SidebarHeader component.
 */
const SidebarHeader = () => {
	return (
		<div className="nfd-editor-chat-sidebar__header-content">
			<h2 className="interface-complementary-area-header__title">
				{__("AI Chat Editor", "wp-module-editor-chat")}
			</h2>
		</div>
	);
};

export default SidebarHeader;
