/**
 * WordPress dependencies
 */
import { useDispatch } from "@wordpress/data";
import { PluginSidebar, PluginSidebarMoreMenuItem } from "@wordpress/editor";
import { useEffect } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * Internal dependencies
 */
import useChat from "../hooks/useChat";
import ActionButtons from "./chat/ActionButtons";
import ChatInput from "./chat/ChatInput";
import ChatMessages from "./chat/ChatMessages";
import WelcomeScreen from "./chat/WelcomeScreen";
import SidebarHeader from "./sidebar/SidebarHeader";
import AILogo from "./ui/AILogo";

const SIDEBAR_NAME = "nfd-editor-chat";
const SIDEBAR_SCOPE = "core";

const ChatEditor = () => {
	const { enableComplementaryArea } = useDispatch(interfaceStore);
	const {
		messages,
		isLoading,
		error,
		status,
		isSaving,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
	} = useChat();

	useEffect(() => {
		enableComplementaryArea(SIDEBAR_SCOPE, SIDEBAR_NAME);
	}, [enableComplementaryArea]);

	// Check if there are any messages with pending actions and count them
	const pendingActionsCount = messages.filter((msg) => msg.hasActions).length;
	const hasPendingActions = pendingActionsCount > 0;

	return (
		<>
			<PluginSidebarMoreMenuItem
				scope={SIDEBAR_SCOPE}
				target={SIDEBAR_NAME}
				icon={<AILogo width={24} height={24} />}
			>
				{__("AI Chat Editor", "wp-module-editor-chat")}
			</PluginSidebarMoreMenuItem>
			<PluginSidebar
				scope={SIDEBAR_SCOPE}
				identifier={SIDEBAR_NAME}
				className="nfd-editor-chat-sidebar"
				closeLabel={__("Close AI Chat Editor", "wp-module-editor-chat")}
				icon={<AILogo width={24} height={24} />}
				headerClassName="nfd-editor-chat-sidebar__header"
				panelClassName="nfd-editor-chat-sidebar__panel"
				header={<SidebarHeader onNewChat={handleNewChat} />}
			>
				<div className="nfd-editor-chat-sidebar__content">
					{messages.length === 0 ? (
						<WelcomeScreen onSendMessage={handleSendMessage} />
					) : (
						<ChatMessages messages={messages} isLoading={isLoading} error={error} status={status} />
					)}
					{hasPendingActions && (
						<ActionButtons
							pendingCount={pendingActionsCount}
							onAccept={handleAcceptChanges}
							onDecline={handleDeclineChanges}
							isSaving={isSaving}
						/>
					)}
					<ChatInput onSendMessage={handleSendMessage} disabled={isLoading} />
				</div>
			</PluginSidebar>
		</>
	);
};

export default ChatEditor;
