/**
 * WordPress dependencies
 */
import { select, useDispatch } from "@wordpress/data";
import { PluginSidebar, PluginSidebarMoreMenuItem } from "@wordpress/editor";
import { useCallback, useEffect, useMemo, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * External dependencies - from wp-module-ai-chat
 */
import { ChatMessages } from "@newfold/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import useEditorChatREST from "../hooks/useEditorChatREST";
import useEditorControls from "../hooks/useEditorControls";
import { IMAGE_BLOCKS, LOGO_BLOCK } from "../services/blockToolbar/blockAI";
import { startBlockProcessing, startImageProcessing } from "../services/blockToolbar/blockHighlight";
import { CHAT_SEND_EVENT } from "../services/blockToolbar/chatBridge";
import { formatImageEditUserMessage } from "../utils/editorContext";
import ChatInput from "./chat/ChatInput";
import WelcomeScreen from "./chat/WelcomeScreen";
import SidebarHeader from "./sidebar/SidebarHeader";
import AILogo from "./ui/AILogo";
import EditorEnhancer from "./editor-enhancer/EditorEnhancer";

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

	// Chat sends (input/welcome screen): if a supported block is selected,
	// trigger the same processing effect used by the toolbar popover.
	const sendWithBlockFeedback = useCallback(
		(message, ...rest) => {
			const selected = select("core/block-editor").getSelectedBlock();
			let enrichedMessage = message;
			let editClientId = null;
			if (selected) {
				if (IMAGE_BLOCKS.has(selected.name) || selected.name === LOGO_BLOCK) {
					startImageProcessing(selected.clientId);
					editClientId = selected.clientId;
				} else {
					startBlockProcessing(selected.clientId);
				}
				enrichedMessage = formatImageEditUserMessage(message, selected.clientId);
			}
			return handleSendMessage(enrichedMessage, message, editClientId, ...rest);
		},
		[handleSendMessage]
	);

	// Listen for messages dispatched from the block toolbar popover.
	useEffect(() => {
		const handler = (e) => {
			const message = e.detail?.message;
			if (!message) return;

			const clientId = e.detail?.clientId || null;
			const enrichedMessage = formatImageEditUserMessage(message, clientId);

			enableComplementaryArea(SIDEBAR_SCOPE, SIDEBAR_NAME);
			handleSendMessage(enrichedMessage, message, clientId);
		};
		window.addEventListener(CHAT_SEND_EVENT, handler);
		return () => window.removeEventListener(CHAT_SEND_EVENT, handler);
	}, [enableComplementaryArea, handleSendMessage]);

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
	const visibleMessages = useMemo(
		() => messages.filter((msg) => msg.type !== "notification"),
		[messages]
	);

	return (
		<>
			<EditorEnhancer />
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
						<WelcomeScreen onSendMessage={sendWithBlockFeedback} />
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
						/>
					)}
					<ChatInput
						onSendMessage={sendWithBlockFeedback}
						onStopRequest={handleStopRequest}
						disabled={isLoading}
					/>
				</div>
			</PluginSidebar>
		</>
	);
};

export default ChatEditor;
