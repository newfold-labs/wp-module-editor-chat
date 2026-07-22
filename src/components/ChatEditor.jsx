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
import EditorChatActionsProvider from "../context/editorChatActions";
import EditorNavigationProvider from "../context/editorNavigation";
import useChatSlideAnimation from "../hooks/useChatSlideAnimation";
import useEditorChatREST from "../hooks/useEditorChatREST";
import useEditorControls from "../hooks/useEditorControls";
import { IMAGE_BLOCKS, LOGO_BLOCK } from "../services/blockToolbar/blockAI";
import { CHAT_STATUS } from "../hooks/chat/constants";
import { clearAllBlockProcessing, startBlockProcessing, startImageProcessing } from "../services/blockToolbar/blockHighlight";
import { CHAT_SEND_EVENT } from "../services/blockToolbar/chatBridge";
import { formatImageEditUserMessage } from "../utils/editorContext";
import ChatInput from "./chat/ChatInput";
import InfoBanner from "./chat/InfoBanner";
import WelcomeScreen from "./chat/WelcomeScreen";
import SidebarHeader from "./sidebar/SidebarHeader";
import AILogo from "./ui/AILogo";
import EditorEnhancer from "./editor-enhancer/EditorEnhancer";

const SIDEBAR_NAME = "nfd-editor-chat";
const SIDEBAR_SCOPE = "core";

const ChatEditor = () => {
	return <EditorNavigationProvider>
		<ChatEditorContent />
	</EditorNavigationProvider>
};

const ChatEditorContent = () => {
	const { enableComplementaryArea } = useDispatch(interfaceStore);

	useChatSlideAnimation(SIDEBAR_SCOPE, SIDEBAR_NAME);

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
		readOnly,
		resumedPostMissing,
		pageConflict,
		handleOpenConversationFromHistory,
		resolvePageConflict,
		handleDeleteCurrentConversation,
		driftInfo,
		dismissDrift,
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
		(apiMessage, displayMessage = apiMessage, ...rest) => {
			const selected = select("core/block-editor").getSelectedBlock();
			let enrichedMessage = apiMessage;
			let editClientId = null;
			if (selected) {
				if (IMAGE_BLOCKS.has(selected.name) || selected.name === LOGO_BLOCK) {
					startImageProcessing(selected.clientId);
					editClientId = selected.clientId;
				} else {
					startBlockProcessing(selected.clientId);
				}
				enrichedMessage = formatImageEditUserMessage(apiMessage, selected.clientId);
			}
			return handleSendMessage(enrichedMessage, displayMessage, editClientId, ...rest);
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

	// If the AI errors out the block attributes never change, so the processing
	// effects would stay stuck. Clear them immediately on error.
	useEffect(() => {
		if (status === CHAT_STATUS.ERROR) {
			clearAllBlockProcessing();
		}
	}, [status]);

	// Disable new chat button when there are no messages (brand new chat)
	const isNewChatDisabled = messages.length === 0;

	// Filter out internal message types from rendering
	// - notification: system context for the AI, not user-facing
	const visibleMessages = useMemo(
		() => messages.filter((msg) => msg.type !== "notification"),
		[messages]
	);

	return (
		<EditorChatActionsProvider
			handleNewChat={handleNewChat}
			isNewChatDisabled={isNewChatDisabled}
			onSelectConversation={handleOpenConversationFromHistory}
		>
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
					{pageConflict && (
						<InfoBanner
							message={__(
								"This chat was about a different page. Open that page, or continue here in read-only?",
								"wp-module-editor-chat"
							)}
							actionLabel={__("Open that page", "wp-module-editor-chat")}
							onAction={() => resolvePageConflict("navigate")}
							onDismiss={() => resolvePageConflict("continue")}
						/>
					)}
					{resumedPostMissing && !pageConflict && (
						<InfoBanner
							message={__("This page no longer exists. This chat is read-only.", "wp-module-editor-chat")}
							actionLabel={__("Delete chat", "wp-module-editor-chat")}
							onAction={handleDeleteCurrentConversation}
						/>
					)}
					{driftInfo && !pageConflict && (
						<InfoBanner
							message={__(
								"This page has been edited since the chat. New requests will use the current page.",
								"wp-module-editor-chat"
							)}
							onDismiss={dismissDrift}
						/>
					)}
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
						disabled={isLoading || readOnly}
					/>
				</div>
			</PluginSidebar>
		</EditorChatActionsProvider>
	);
};

export default ChatEditor;
