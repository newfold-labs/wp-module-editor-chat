/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { useDispatch } from "@wordpress/data";
import { useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ArrowUp, CircleStop } from "lucide-react";

/**
 * Internal dependencies
 */
import useSelectedBlock from "../../hooks/useSelectedBlock";
import ContextTag from "../ui/ContextTag";

/**
 * ChatInput Component
 *
 * @param {Object}   props               - The component props.
 * @param {Function} props.onSendMessage - The function to call when the message is sent.
 * @param {Function} props.onStopRequest - The function to call when the stop button is clicked.
 * @param {boolean}  props.disabled      - Whether the input is disabled.
 * @return {JSX.Element} The ChatInput component.
 */
const ChatInput = ({ onSendMessage, onStopRequest, disabled = false }) => {
	const [message, setMessage] = useState("");
	const textareaRef = useRef(null);
	const selectedBlock = useSelectedBlock();
	const { clearSelectedBlock } = useDispatch("core/block-editor");

	// Auto-resize textarea as user types
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
			const newHeight = Math.min(textareaRef.current.scrollHeight, 200);
			textareaRef.current.style.height = `${newHeight}px`;
		}
	}, [message]);

	// Focus textarea when it becomes enabled again (after AI response)
	useEffect(() => {
		if (!disabled && textareaRef.current) {
			setTimeout(() => {
				textareaRef.current.focus();
			}, 100);
		}
	}, [disabled]);

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

	return (
		<div className="nfd-editor-chat-input">
			<div className="nfd-editor-chat-input__container">
				<textarea
					name="nfd-editor-chat-input"
					ref={textareaRef}
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder={__("How can I help you today?", "wp-module-editor-chat")}
					className="nfd-editor-chat-input__textarea"
					rows={1}
					disabled={disabled}
				/>
				<div className="nfd-editor-chat-input__actions">
					{selectedBlock && (
						<ContextTag
							block={selectedBlock}
							onRemove={(clientId) => {
								clearSelectedBlock(clientId);
							}}
						/>
					)}
					{disabled ? (
						<Button
							icon={<CircleStop width={16} height={16} />}
							label={__("Stop generating", "wp-module-editor-chat")}
							onClick={onStopRequest}
							className="nfd-editor-chat-input__stop"
						/>
					) : (
						<Button
							icon={<ArrowUp width={16} height={16} />}
							label={__("Send message", "wp-module-editor-chat")}
							onClick={handleSubmit}
							className="nfd-editor-chat-input__submit"
							disabled={!message.trim()}
						/>
					)}
				</div>
			</div>
			<div className="nfd-editor-chat-input__disclaimer">
				{__("AI-generated content is not guaranteed for accuracy.", "wp-module-editor-chat")}
			</div>
		</div>
	);
};

export default ChatInput;
