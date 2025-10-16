/**
 * External dependencies
 */
import { CircleX } from "lucide-react";

/**
 * ErrorAlert Component
 *
 * A reusable error alert component that displays error messages
 * in a red box with an exclamation mark icon.
 *
 * @param {Object} props           - The component props.
 * @param {string} props.message   - The error message to display.
 * @param {string} props.className - Additional CSS classes (optional).
 * @return {JSX.Element} The ErrorAlert component.
 */
const ErrorAlert = ({ message, className = "" }) => {
	return (
		<div className={`nfd-editor-chat-error-alert ${className}`}>
			<div className="nfd-editor-chat-error-alert__icon">
				<CircleX width={16} height={16} />
			</div>
			<div className="nfd-editor-chat-error-alert__content">
				<div className="nfd-editor-chat-error-alert__message">{message}</div>
			</div>
		</div>
	);
};

export default ErrorAlert;
