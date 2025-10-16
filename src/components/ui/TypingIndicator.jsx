/**
 * TypingIndicator Component
 *
 * Displays an animated typing indicator with dots and a loading message.
 *
 * @return {JSX.Element} The TypingIndicator component.
 */
const TypingIndicator = () => {
	return (
		<div className="nfd-editor-chat-message nfd-editor-chat-message--assistant">
			<div className="nfd-editor-chat-message__content">
				<div className="nfd-editor-chat-typing-indicator">
					<div className="nfd-editor-chat-typing-indicator__loader"></div>
				</div>
			</div>
		</div>
	);
};

export default TypingIndicator;
