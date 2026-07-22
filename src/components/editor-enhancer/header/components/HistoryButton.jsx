/**
 * HistoryButton — header icon button that toggles a portal-rendered dropdown
 * panel listing the user's recent conversations. Lives next to NewChatButton
 * in the real (visible) editor toolbar — the legacy PluginSidebar header is
 * hidden via CSS in this build, so this is the actual mount point.
 */
import { createPortal, useCallback, useEffect, useLayoutEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import HeaderIconButton from "./HeaderIconButton";
import { HistoryIcon } from "../icons";
import { useEditorChatActions } from "../../../../context/editorChatActions";
import useConversationHistory from "../../../../hooks/chat/useConversationHistory";
import ConversationHistoryPanel from "../../../sidebar/ConversationHistoryPanel";

/**
 * @return {Element|null} The history trigger + portal panel, or null for non-editors.
 */
export default function HistoryButton() {
	const { onSelectConversation } = useEditorChatActions();

	const [open, setOpen] = useState(false);
	const triggerRef = useRef(null);
	const panelRef = useRef(null);
	const [position, setPosition] = useState({ top: 0, left: 0, openUp: false });

	const { items, isLoading, hasMore, loadMore, deleteItem } = useConversationHistory({ open });

	const updatePosition = useCallback(() => {
		if (!triggerRef.current) {
			return;
		}
		const rect = triggerRef.current.getBoundingClientRect();
		const panelHeight = 360;
		const spaceBelow = window.innerHeight - rect.bottom;
		const openUp = spaceBelow < panelHeight && rect.top > spaceBelow;
		setPosition({ top: openUp ? rect.top : rect.bottom, left: rect.left, openUp });
	}, []);

	useLayoutEffect(() => {
		if (open) {
			updatePosition();
		}
	}, [open, updatePosition]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const handleResize = () => updatePosition();
		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [open, updatePosition]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const handleClickOutside = (e) => {
			if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) {
				return;
			}
			setOpen(false);
		};
		const handleEscape = (e) => {
			if (e.key === "Escape") {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [open]);

	const handleSelect = useCallback(
		(item) => {
			setOpen(false);
			onSelectConversation(item);
		},
		[onSelectConversation]
	);

	const handleDelete = useCallback(
		(id) => {
			deleteItem(id).catch(() => {
				// eslint-disable-next-line no-console
				console.warn("[EditorChat] Failed to delete conversation", id);
			});
		},
		[deleteItem]
	);

	// Gate rendering AFTER all hooks (never conditionally skip a hook call —
	// that breaks React's Rules of Hooks). `open` can only become true via the
	// button below, so once we render null here, useConversationHistory's
	// effect never actually fetches.
	if (!window.nfdEditorChat?.isEditor) {
		return null;
	}

	const panel = (
		<div
			ref={panelRef}
			className={`nfd-editor-chat-history-dropdown${position.openUp ? " nfd-editor-chat-history-dropdown--up" : ""}`}
			role="dialog"
			aria-label={__("Recent conversations", "wp-module-editor-chat")}
			style={{
				position: "fixed",
				top: position.openUp ? "auto" : position.top,
				bottom: position.openUp ? window.innerHeight - position.top : "auto",
				left: position.left,
				zIndex: 100000,
			}}
		>
			<div className="nfd-editor-chat-history-dropdown__header">
				{__("Recent conversations", "wp-module-editor-chat")}
			</div>
			<ConversationHistoryPanel
				items={items}
				isLoading={isLoading}
				hasMore={hasMore}
				onLoadMore={loadMore}
				onSelect={handleSelect}
				onDelete={handleDelete}
			/>
		</div>
	);

	return (
		<>
			<span ref={triggerRef} style={{ display: "inline-flex" }}>
				<HeaderIconButton
					onClick={() => setOpen((v) => !v)}
					id="nfd-editor-chat__header__history"
					label={__("Recent conversations", "wp-module-editor-chat")}
					active={open}
					showTooltip
				>
					<HistoryIcon />
				</HeaderIconButton>
			</span>
			{open && createPortal(panel, document.body)}
		</>
	);
}
