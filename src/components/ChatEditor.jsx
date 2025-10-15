/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { useDispatch, useSelect } from "@wordpress/data";
import { PluginSidebar, PluginSidebarMoreMenuItem } from "@wordpress/editor";
import { useEffect, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * External dependencies
 */
import { MessageSquarePlus, Maximize2, Palette, Edit3, FilePlus, Layers } from "lucide-react";

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
	const [messages, setMessages] = useState([]);
	const [isLoading, setIsLoading] = useState(false);

	// Get current user data
	const currentUser = useSelect((select) => {
		const { getCurrentUser } = select("core");
		return getCurrentUser();
	}, []);

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

	const handleNewChat = () => {
		// Reset messages to empty array to show welcome screen
		setMessages([]);
	};

	const handleExpandWindow = () => {
		// TODO: Implement expand to new window functionality
		console.log("Expand to new window clicked");
	};

	// Welcome screen component
	const WelcomeScreen = () => {
		const suggestions = [
			{
				icon: <Edit3 width={16} height={16} />,
				text: __("Add a section", "wp-module-editor-chat"),
				action: () => handleSendMessage("Add a section"),
			},
			{
				icon: <Layers width={16} height={16} />,
				text: __("Update content", "wp-module-editor-chat"),
				action: () => handleSendMessage("Update content"),
			},
			{
				icon: <Palette width={16} height={16} />,
				text: __("Update color scheme", "wp-module-editor-chat"),
				action: () => handleSendMessage("Update color scheme"),
			},
			{
				icon: <FilePlus width={16} height={16} />,
				text: __("Add a new page", "wp-module-editor-chat"),
				action: () => handleSendMessage("Add a new page"),
			},
		];

		return (
			<div className="nfd-chat-welcome">
				<div className="nfd-chat-welcome__content">
					<div className="nfd-chat-welcome__avatar">
						<AIAvatar width={48} height={48} />
					</div>
					<div className="nfd-chat-welcome__message">
						<div className="nfd-chat-welcome__title">
							{__("Hi, I'm BLU, your AI assistant.", "wp-module-editor-chat")}
						</div>
						<div className="nfd-chat-welcome__subtitle">
							{__("I can help you update page sections and styles,", "wp-module-editor-chat")}
						</div>
						<div className="nfd-chat-welcome__subtitle">
							{__("add, remove, or edit existing content.", "wp-module-editor-chat")}
						</div>
					</div>
				</div>
				<div className="nfd-chat-welcome__suggestions">
					{suggestions.map((suggestion, index) => (
						<button
							key={index}
							className="nfd-chat-welcome__suggestion"
							onClick={suggestion.action}
						>
							<div className="nfd-chat-welcome__suggestion-icon">{suggestion.icon}</div>
							<div className="nfd-chat-welcome__suggestion-text">{suggestion.text}</div>
						</button>
					))}
				</div>
			</div>
		);
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
					<div className="nfd-editor-chat-sidebar__header-content">
						<h2 className="interface-complementary-area-header__title">
							{__("AI Chat Editor", "wp-module-editor-chat")}
						</h2>
						<div className="nfd-editor-chat-sidebar__header-actions">
							<Button
								icon={<MessageSquarePlus width={16} height={16} />}
								label={__("Start new chat", "wp-module-editor-chat")}
								onClick={handleNewChat}
								className="nfd-editor-chat-sidebar__new-chat"
								size="small"
							/>
							<Button
								icon={<Maximize2 width={16} height={16} />}
								label={__("Open in new window", "wp-module-editor-chat")}
								onClick={handleExpandWindow}
								className="nfd-editor-chat-sidebar__expand"
								size="small"
							/>
						</div>
					</div>
				}
			>
				<div className="nfd-editor-chat-sidebar__content">
					{messages.length === 0 ? <WelcomeScreen /> : <ChatMessages messages={messages} />}
					<ChatInput onSendMessage={handleSendMessage} disabled={isLoading} />
				</div>
			</PluginSidebar>
		</>
	);
};

export default ChatEditor;
