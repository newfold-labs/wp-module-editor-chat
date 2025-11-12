/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";

/**
 * SuggestionButton Component
 *
 * A reusable suggestion button component that can be used in various contexts.
 * Takes an icon, text, and onClick action as parameters.
 *
 * @param {Object}      props           - The component props.
 * @param {JSX.Element} props.icon      - The icon element to display.
 * @param {string}      props.text      - The text to display.
 * @param {Function}    props.onClick   - The function to call when clicked.
 * @param {string}      props.className - Additional CSS classes (optional).
 * @return {JSX.Element} The SuggestionButton component.
 */
const SuggestionButton = ({ icon, text, onClick, className = "" }) => {
	return (
		<Button className={`nfd-editor-chat-suggestion ${className}`} onClick={onClick}>
			<div className="nfd-editor-chat-suggestion__icon">{icon}</div>
			<div className="nfd-editor-chat-suggestion__text">{text}</div>
		</Button>
	);
};

export default SuggestionButton;
