/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { useState, useRef, useEffect } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ArrowUp, Paperclip } from "lucide-react";

/**
 * ChatInput Component
 *
 * @param {Object}   props               - The component props.
 * @param {Function} props.onSendMessage - The function to call when the message is sent.
 * @param {boolean}  props.disabled      - Whether the input is disabled.
 * @returns {JSX.Element} The ChatInput component.
 */
const ChatInput = ({ onSendMessage, disabled = false }) => {
	const [message, setMessage] = useState("");
	const textareaRef = useRef(null);

	// Auto-resize textarea as user types
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
			textareaRef.current.style.height = `${newHeight}px`;
		}
	}, [message]);

	const handleSubmit = () => {
		if (message.trim() && !disabled) {
			onSendMessage(message);
			setMessage("");
			// Reset textarea height and maintain focus
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
				textareaRef.current.focus();
			}
		}
	};

	const handleKeyDown = (e) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	};

	const handleFileUpload = () => {
		// TODO: Implement file upload functionality
		console.log("File upload clicked");
	};

	return (
		<div className="nfd-chat-input">
			<div className="nfd-chat-input__container">
				<textarea
					name="nfd-chat-input"
					ref={textareaRef}
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={__("How can I help you today?", "wp-module-editor-chat")}
					className="nfd-chat-input__textarea"
					rows={1}
					disabled={disabled}
				/>
				<div className="nfd-chat-input__actions">
					<Button
						icon={<Paperclip width={16} height={16} />}
						label={__("Attach file", "wp-module-editor-chat")}
						onClick={handleFileUpload}
						className="nfd-chat-input__attach"
						disabled={disabled}
					/>
					<Button
						icon={<ArrowUp width={16} height={16} />}
						label={__("Send message", "wp-module-editor-chat")}
						onClick={handleSubmit}
						className="nfd-chat-input__submit"
						disabled={disabled || !message.trim()}
					/>
				</div>
			</div>
			<div className="nfd-chat-input__disclaimer">
				{__("AI-generated content is not guaranteed for accuracy.", "wp-module-editor-chat")}
			</div>
		</div>
	);
};

export default ChatInput;
