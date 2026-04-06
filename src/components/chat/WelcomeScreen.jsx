/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ArrowUpDown, Edit3, Layers, Palette } from "lucide-react";
import { SuggestionButton } from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import AILogo from "../ui/AILogo";

/**
 * WelcomeScreen Component
 *
 * Displays the welcome screen with AI avatar, introduction message, and suggestion tags.
 *
 * @param {Object}   props               - The component props.
 * @param {Function} props.onSendMessage - The function to call when a suggestion is clicked.
 * @return {JSX.Element} The WelcomeScreen component.
 */
const WelcomeScreen = ({ onSendMessage }) => {
	const suggestions = [
		{
			icon: <Layers width={16} height={16} />,
			text: __("Add a section", "wp-module-editor-chat"),
			action: () => onSendMessage("Add a section"),
		},
		{
			icon: <Palette width={16} height={16} />,
			text: __("Change colors", "wp-module-editor-chat"),
			action: () => onSendMessage("Change colors"),
		},
		{
			icon: <Edit3 width={16} height={16} />,
			text: __("Rewrite content", "wp-module-editor-chat"),
			action: () => onSendMessage("Rewrite content"),
		},
		{
			icon: <ArrowUpDown width={16} height={16} />,
			text: __("Rearrange layout", "wp-module-editor-chat"),
			action: () => onSendMessage("Rearrange layout"),
		},
	];

	return (
		<div className="nfd-editor-chat-welcome">
			<div className="nfd-editor-chat-welcome__content">
				<div className="nfd-editor-chat-welcome__avatar">
					<AILogo width={48} height={48} />
				</div>
				<div className="nfd-editor-chat-welcome__message">
					<div className="nfd-editor-chat-welcome__title">
						{__("Hi, I'm BLU, your AI assistant.", "wp-module-editor-chat")}
					</div>
					<div className="nfd-editor-chat-welcome__subtitle">
						{__("I can help you update page sections and styles,", "wp-module-editor-chat")}
					</div>
					<div className="nfd-editor-chat-welcome__subtitle">
						{__("add, remove, or edit existing content.", "wp-module-editor-chat")}
					</div>
				</div>
			</div>
			<div className="nfd-editor-chat-suggestions">
				{suggestions.map((suggestion, index) => (
					<SuggestionButton
						key={index}
						icon={suggestion.icon}
						text={suggestion.text}
						onClick={suggestion.action}
					/>
				))}
			</div>
		</div>
	);
};

export default WelcomeScreen;
