/**
 * WordPress dependencies
 */
import { useDispatch } from "@wordpress/data";
import { PluginSidebar, PluginSidebarMoreMenuItem } from "@wordpress/editor";
import { useEffect, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * Internal dependencies
 */
import { ReactComponent as SparksIcon } from "../svg/sparks.svg";
import ChatInput from "./ChatInput";
import ChatMessages from "./ChatMessages";

// AI Avatar component that matches the chat avatar design
const AIAvatar = ({ width = 24, height = 24 }) => (
	<div
		style={{
			width: width,
			height: height,
			borderRadius: "50%",
			background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			color: "#fff",
		}}
	>
		<SparksIcon width={width * 0.75} height={height * 0.75} fill="currentColor" />
	</div>
);

const SIDEBAR_NAME = "nfd-editor-chat";
const SIDEBAR_SCOPE = "core";

const ChatEditor = () => {
	const { enableComplementaryArea } = useDispatch(interfaceStore);
	const [messages, setMessages] = useState([
		{
			type: "assistant",
			content: __("Hello! How can I help you with your content today?", "wp-module-editor-chat"),
		},
	]);
	const [isLoading, setIsLoading] = useState(false);

	useEffect(() => {
		enableComplementaryArea(SIDEBAR_SCOPE, SIDEBAR_NAME);
	}, [enableComplementaryArea]);

	const handleSendMessage = async (messageContent) => {
		// Add user message
		const userMessage = {
			type: "user",
			content: messageContent,
		};
		setMessages((prev) => [...prev, userMessage]);
		setIsLoading(true);

		// TODO: Replace with actual API call
		// Simulate AI response
		setTimeout(() => {
			const aiMessage = {
				type: "assistant",
				content: "This is a placeholder response. The AI functionality will be implemented soon.",
			};
			setMessages((prev) => [...prev, aiMessage]);
			setIsLoading(false);
		}, 1000);
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
				header={
					<h2 className="interface-complementary-area-header__title">
						{__("AI Chat Editor", "wp-module-editor-chat")}
					</h2>
				}
			>
				<div className="nfd-editor-chat-sidebar__content">
					<ChatMessages messages={messages} />
					<ChatInput onSendMessage={handleSendMessage} disabled={isLoading} />
				</div>
			</PluginSidebar>
		</>
	);
};

export default ChatEditor;
