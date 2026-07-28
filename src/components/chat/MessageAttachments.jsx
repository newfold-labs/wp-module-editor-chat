/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * MessageAttachments — striscia di miniature immagine mostrata sopra la bolla
 * di un messaggio utente. Miniature non cliccabili. Solo immagini (il
 * filtraggio avviene a monte).
 *
 * @param {Object} props
 * @param {Array}  props.attachments Array di { url, name, type }.
 * @return {JSX.Element|null}
 */
const MessageAttachments = ({ attachments = [] }) => {
	if (!attachments.length) {
		return null;
	}
	return (
		<div className="nfd-editor-chat-message-attachments">
			{attachments.map((att, i) => (
				<span key={att.url || i} className="nfd-editor-chat-message-attachments__item">
					<img
						className="nfd-editor-chat-message-attachments__img"
						src={att.url}
						alt={att.name || __("Uploaded image", "wp-module-editor-chat")}
						loading="lazy"
					/>
				</span>
			))}
		</div>
	);
};

export default MessageAttachments;
