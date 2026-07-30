/**
 * WordPress dependencies
 */
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * MessageAttachments — striscia di miniature immagine mostrata sopra la bolla
 * di un messaggio utente. Miniature non cliccabili. Solo immagini (il
 * filtraggio avviene a monte).
 *
 * Se un'immagine non carica (404 / file corrotto / rete), la relativa miniatura
 * viene rimossa via onError; se falliscono tutte, la striscia non viene renderizzata.
 *
 * @param {Object} props
 * @param {Array}  props.attachments Array di { url, name, type }.
 * @return {JSX.Element|null}
 */
const MessageAttachments = ({ attachments = [] }) => {
	// URL (o indice di fallback) delle immagini che non sono riuscite a caricare.
	const [failed, setFailed] = useState(() => new Set());

	const items = attachments
		.map((att, i) => ({ att, id: att.url || i }))
		.filter(({ id }) => !failed.has(id));

	if (!items.length) {
		return null;
	}

	const markFailed = (id) =>
		setFailed((prev) => {
			if (prev.has(id)) {
				return prev;
			}
			const next = new Set(prev);
			next.add(id);
			return next;
		});

	return (
		<div className="nfd-editor-chat-message-attachments">
			{items.map(({ att, id }) => (
				<span key={id} className="nfd-editor-chat-message-attachments__item">
					<img
						className="nfd-editor-chat-message-attachments__img"
						src={att.url}
						alt={att.name || __("Uploaded image", "wp-module-editor-chat")}
						loading="lazy"
						onError={() => markFailed(id)}
					/>
				</span>
			))}
		</div>
	);
};

export default MessageAttachments;
