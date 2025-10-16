/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Edit3, FilePlus, Layers, Palette } from "lucide-react";

/**
 * Internal dependencies
 */
import AILogo from "../ui/AILogo";
import SuggestionButton from "../ui/SuggestionButton";

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
			icon: <Edit3 width={16} height={16} />,
			text: __("Add a new section", "wp-module-editor-chat"),
			action: () => onSendMessage("Add a new section"),
		},
		{
			icon: <Palette width={16} height={16} />,
			text: __("Update color scheme", "wp-module-editor-chat"),
			action: () => onSendMessage("Update color scheme"),
		},
		{
			icon: <FilePlus width={16} height={16} />,
			text: __("Create new page", "wp-module-editor-chat"),
			action: () => onSendMessage("Create new page"),
		},
		{
			icon: <Layers width={16} height={16} />,
			text: __("Edit content", "wp-module-editor-chat"),
			action: () => onSendMessage("Edit content"),
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
