/**
 * WordPress dependencies
 */
import { useDispatch } from "@wordpress/data";
import { PluginSidebar, PluginSidebarMoreMenuItem } from "@wordpress/editor";
import { useEffect, useMemo, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * External dependencies - from wp-module-ai-chat
 */
import { ChatMessages } from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import useEditorChatREST from "../hooks/useEditorChatREST";
import useEditorControls from "../hooks/useEditorControls";
import ChatInput from "./chat/ChatInput";
import WelcomeScreen from "./chat/WelcomeScreen";
import SidebarHeader from "./sidebar/SidebarHeader";
import AILogo from "./ui/AILogo";

const SIDEBAR_NAME = "nfd-editor-chat";
const SIDEBAR_SCOPE = "core";

const ChatEditor = () => {
	const { enableComplementaryArea } = useDispatch(interfaceStore);
	const { setShowTemplate } = useEditorControls();
	const [templateLocked, setTemplateLocked] = useState(false);
	const {
		messages,
		isLoading,
		error,
		status,
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		handleSendMessage,
		handleNewChat,
		handleStopRequest,
	} = useEditorChatREST();

	// Phase 1: Enable template mode (show header & footer)
	useEffect(() => {
		const didShowTemplate = setShowTemplate();
		if (didShowTemplate) {
			setTemplateLocked(true);
		}
	}, [setShowTemplate]);

	// Phase 2: After template is locked, open sidebar
	useEffect(() => {
		if (templateLocked) {
			enableComplementaryArea(SIDEBAR_SCOPE, SIDEBAR_NAME);
		}
	}, [templateLocked, enableComplementaryArea]);

	// Disable new chat button when there are no messages (brand new chat)
	const isNewChatDisabled = messages.length === 0;

	// Filter out internal message types from rendering
	// - notification: system context for the AI, not user-facing
	// - tool_execution: tool progress tracked internally, not shown in chat
	const visibleMessages = useMemo(
		() => messages.filter((msg) => msg.type !== "notification"),
		[messages]
	);

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
					{visibleMessages.length === 0 ? (
						<WelcomeScreen onSendMessage={handleSendMessage} />
					) : (
						<ChatMessages
							messages={visibleMessages}
							isLoading={isLoading}
							error={error}
							status={status}
							activeToolCall={activeToolCall}
							toolProgress={toolProgress}
							executedTools={executedTools}
							pendingTools={pendingTools}
							textDomain="wp-module-editor-chat"
							messageBubbleStyle="minimal"
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
