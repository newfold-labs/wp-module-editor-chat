/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { __, sprintf } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Plus, Sparkles } from "lucide-react";

/**
 * Internal dependencies
 */
import ConversationHistoryDropdown from "./ConversationHistoryDropdown";

/**
 * SidebarHeader Component
 *
 * Displays the sidebar header with title and action buttons.
 *
 * @param {Object}   props                   Component props
 * @param {Function} props.onNewChat         Function to call when new chat is requested
 * @param {boolean}  props.isNewChatDisabled Whether the new chat button should be disabled
 * @param {Function} [props.onOpenConversation]      Resumes a conversation from history (hides the history button when omitted)
 * @param {number}   [props.activeConversationId]    Id of the conversation currently open
 * @param {Function} [props.onActiveConversationDeleted] Called after the open conversation was deleted from history
 * @param {boolean}  [props.isHistoryDisabled]       Whether the history button should be disabled
 * @return {Element} The SidebarHeader component.
 */
const getBrandName = () => {
	const name = window?.nfdEditorChat?.brand?.name;
	return name || __("Host", "wp-module-editor-chat");
};

const SidebarHeader = ({
	onNewChat,
	isNewChatDisabled = false,
	onOpenConversation,
	activeConversationId = null,
	onActiveConversationDeleted,
	isHistoryDisabled = false,
}) => {
	// Non-editors cannot use the conversations API, so never show the dropdown.
	const showHistory = Boolean(onOpenConversation) && window?.nfdEditorChat?.isEditor === true;

	const title = sprintf(
		/* translators: %s: brand display name */
		__("%s AI Assistant", "wp-module-editor-chat"),
		getBrandName()
	);

	return (
		<div className="nfd-editor-chat-sidebar__header-content">
			<div className="interface-complementary-area-header__title">
				<Sparkles width={15} height={15} />
				<h2>{title}</h2>
			</div>
			{(onNewChat || showHistory) && (
				<div className="nfd-editor-chat-sidebar__header-actions">
					{showHistory && (
						<ConversationHistoryDropdown
							disabled={isHistoryDisabled}
							activeConversationId={activeConversationId}
							onOpen={onOpenConversation}
							onActiveDeleted={onActiveConversationDeleted}
						/>
					)}
					{onNewChat && (
					<Button
						icon={<Plus width={16} height={16} />}
						label={__("New chat", "wp-module-editor-chat")}
						onClick={onNewChat}
						className="nfd-editor-chat-sidebar__new-chat"
						disabled={isNewChatDisabled}
					/>
					)}
				</div>
			)}
		</div>
	);
};

export default SidebarHeader;
