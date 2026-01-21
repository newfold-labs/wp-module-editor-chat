/**
 * WordPress dependencies
 */
import { useDispatch } from "@wordpress/data";
import { PluginSidebar, PluginSidebarMoreMenuItem } from "@wordpress/editor";
import { useEffect } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * External dependencies - from wp-module-ai-chat
 */
import { ChatMessages } from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import useEditorChat from "../hooks/useEditorChat";
import ActionButtons from "./chat/ActionButtons";
import ChatInput from "./chat/ChatInput";
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
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
	} = useEditorChat();

	useEffect(() => {
		enableComplementaryArea(SIDEBAR_SCOPE, SIDEBAR_NAME);
	}, [enableComplementaryArea]);

	// Check if there are any messages with pending actions and count them
	const pendingActionsCount = messages.filter((msg) => msg.hasActions).length;
	const hasPendingActions = pendingActionsCount > 0;

	// Disable new chat button when there are no messages (brand new chat)
	const isNewChatDisabled = messages.length === 0;

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
				header={<SidebarHeader onNewChat={handleNewChat} isNewChatDisabled={isNewChatDisabled} />}
			>
				<div className="nfd-editor-chat-sidebar__content">
					{messages.length === 0 ? (
						<WelcomeScreen onSendMessage={handleSendMessage} />
					) : (
						<ChatMessages
							messages={messages}
							isLoading={isLoading}
							error={error}
							status={status}
							activeToolCall={activeToolCall}
							toolProgress={toolProgress}
							executedTools={executedTools}
							pendingTools={pendingTools}
							textDomain="wp-module-editor-chat"
						/>
					)}
					{hasPendingActions && (
						<ActionButtons
							pendingCount={pendingActionsCount}
							onAccept={handleAcceptChanges}
							onDecline={handleDeclineChanges}
							isSaving={isSaving}
						/>
					)}
					<ChatInput
						onSendMessage={handleSendMessage}
						onStopRequest={handleStopRequest}
						disabled={isLoading}
					/>
				</div>
			</PluginSidebar>
		</>
	);
};

export default ChatEditor;
