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
import AIAvatar from "./ui/AIAvatar";
import ChatInput from "./chat/ChatInput";
import ChatMessages from "./chat/ChatMessages";
import SidebarHeader from "./sidebar/SidebarHeader";
import WelcomeScreen from "./sidebar/WelcomeScreen";

const SIDEBAR_NAME = "nfd-editor-chat";
const SIDEBAR_SCOPE = "core";

const ChatEditor = () => {
	const { enableComplementaryArea } = useDispatch(interfaceStore);
	const { messages, isLoading, handleSendMessage, handleNewChat } = useChat();

	useEffect(() => {
		enableComplementaryArea(SIDEBAR_SCOPE, SIDEBAR_NAME);
	}, [enableComplementaryArea]);

	const handleExpandWindow = () => {
		// TODO: Implement expand to new window functionality
		// console.log("Expand to new window clicked");
	};

	return (
		<>
			<PluginSidebarMoreMenuItem
				scope={SIDEBAR_SCOPE}
				target={SIDEBAR_NAME}
				icon={<AIAvatar width={24} height={24} />}
			>
				{__("AI Chat Editor", "wp-module-editor-chat")}
			</PluginSidebarMoreMenuItem>
			<PluginSidebar
				scope={SIDEBAR_SCOPE}
				identifier={SIDEBAR_NAME}
				className="nfd-editor-chat-sidebar"
				closeLabel={__("Close AI Chat Editor", "wp-module-editor-chat")}
				icon={<AIAvatar width={24} height={24} />}
				headerClassName="nfd-editor-chat-sidebar__header"
				panelClassName="nfd-editor-chat-sidebar__panel"
				header={<SidebarHeader onNewChat={handleNewChat} onExpand={handleExpandWindow} />}
			>
				<div className="nfd-editor-chat-sidebar__content">
					{messages.length === 0 ? (
						<WelcomeScreen onSendMessage={handleSendMessage} />
					) : (
						<ChatMessages messages={messages} />
					)}
					<ChatInput onSendMessage={handleSendMessage} disabled={isLoading} />
				</div>
			</PluginSidebar>
		</>
	);
};

export default ChatEditor;
