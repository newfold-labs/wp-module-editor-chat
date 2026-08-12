/**
 * WordPress dependencies
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ChatMessage, ErrorAlert, TypingIndicator } from "@newfold/wp-module-ai-chat";
import { ChevronDown } from "lucide-react";

/**
 * Internal dependencies
 */
import MessageAttachments from "./MessageAttachments";

// Distanza dal fondo (px) entro cui l'utente è "ancorato" e continuiamo l'auto-scroll.
const SCROLL_BOTTOM_THRESHOLD = 80;
// Px oltre il top prima di considerare l'area "scrollata" (per l'elevazione header).
const SCROLL_ELEVATION_THRESHOLD = 8;

/**
 * EditorChatMessages — contenitore scrollabile dei messaggi per la chat editor.
 *
 * Fork snello del ChatMessages di ai-chat: riusa i componenti esportati
 * (ChatMessage/TypingIndicator/ErrorAlert) e mantiene solo ciò che editor-chat
 * usa davvero (scroll-anchor, jump-to-latest, typing, errore). Lista piatta,
 * senza raggruppamento/divisori per data. Gli stati di connessione WebSocket e
 * edit/retry di ai-chat NON sono usati qui. In più, per i messaggi utente con
 * allegati immagine, mostra una striscia di miniature sopra la bolla.
 *
 * @param {Object}  props
 * @param {Array}   props.messages       Messaggi da mostrare.
 * @param {boolean} props.isLoading      Se l'AI sta generando.
 * @param {string}  props.error          Messaggio d'errore (opzionale).
 * @param {string}  props.status         Stato corrente (opzionale).
 * @param {Object}  props.activeToolCall Tool call attivo (opzionale).
 * @param {string}  props.toolProgress   Messaggio di progresso tool (opzionale).
 * @param {Array}   props.executedTools  Tool eseguiti (opzionale).
 * @param {Array}   props.pendingTools   Tool in attesa (opzionale).
 * @return {JSX.Element}
 */
const EditorChatMessages = ({
	messages = [],
	isLoading = false,
	error = null,
	status = null,
	activeToolCall = null,
	toolProgress = null,
	executedTools = [],
	pendingTools = [],
}) => {
	const scrollContainerRef = useRef(null);
	const [scrollTrigger, setScrollTrigger] = useState(0);
	const [isAnchored, setIsAnchored] = useState(true);
	const [isScrolled, setIsScrolled] = useState(false);

	const scrollToBottom = useCallback((behavior = "smooth") => {
		const el = scrollContainerRef.current;
		if (!el) {
			return;
		}
		el.scrollTo({ top: el.scrollHeight - el.clientHeight, behavior });
	}, []);

	useEffect(() => {
		const el = scrollContainerRef.current;
		if (!el) {
			return undefined;
		}
		const handleScroll = () => {
			const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
			setIsAnchored(distanceFromBottom < SCROLL_BOTTOM_THRESHOLD);
			setIsScrolled(el.scrollTop > SCROLL_ELEVATION_THRESHOLD);
		};
		el.addEventListener("scroll", handleScroll, { passive: true });
		handleScroll();
		return () => el.removeEventListener("scroll", handleScroll);
	}, []);

	useEffect(() => {
		if (isAnchored) {
			scrollToBottom();
		}
	}, [messages, isLoading, toolProgress, scrollTrigger, isAnchored, scrollToBottom]);

	const onContentGrow = useCallback(() => setScrollTrigger((t) => t + 1), []);

	const hasActiveToolExecution =
		activeToolCall || executedTools.length > 0 || pendingTools.length > 0;

	const handleJumpToLatest = useCallback(() => {
		scrollToBottom("smooth");
		setIsAnchored(true);
	}, [scrollToBottom]);

	return (
		<div className="nfd-ai-chat-messages-shell" data-scrolled={isScrolled ? "true" : undefined}>
			<div ref={scrollContainerRef} className="nfd-ai-chat-messages">
				{messages.map((msg, globalIdx) => {
					const isLastAssistant =
						globalIdx === messages.length - 1 &&
						(msg.type === "assistant" || msg.role === "assistant");
					const isUser = msg.type === "user" || msg.role === "user";
					const imageAttachments =
						isUser && Array.isArray(msg.attachments)
							? msg.attachments.filter((a) => a && a.url && (a.type || "").startsWith("image/"))
							: [];
					return (
						<Fragment key={msg.id || `m-${globalIdx}`}>
							{imageAttachments.length > 0 && <MessageAttachments attachments={imageAttachments} />}
							<ChatMessage
								message={msg.content}
								type={msg.type}
								timestamp={msg.timestamp}
								animateTyping={isLastAssistant && msg.animateTyping === true}
								onContentGrow={isLastAssistant ? onContentGrow : undefined}
								executedTools={msg.executedTools}
								toolResults={msg.toolResults}
								status={msg.status}
								isFallback={msg.isFallback === true}
							/>
						</Fragment>
					);
				})}
				{error && <ErrorAlert message={error} />}
				{isLoading && (
					<TypingIndicator
						status={status}
						activeToolCall={activeToolCall}
						toolProgress={toolProgress}
						executedTools={hasActiveToolExecution ? executedTools : []}
						pendingTools={pendingTools}
					/>
				)}
			</div>
			{!isAnchored && messages.length > 0 && (
				<button
					type="button"
					className="nfd-ai-chat-messages__jump"
					onClick={handleJumpToLatest}
					aria-label={__("Jump to latest message", "wp-module-editor-chat")}
				>
					<ChevronDown size={16} aria-hidden="true" />
				</button>
			)}
		</div>
	);
};

export default EditorChatMessages;
