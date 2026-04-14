/**
 * useChatSideEffects — Manages all side effects for the editor chat hook.
 *
 * Consolidates ref syncing, tool lifecycle, save watching, and
 * active-chat persistence (for reload-resume) into a single hook.
 */
import { useEffect, useRef } from "@wordpress/element";

import { upsertToolExecMsg } from "../../services/toolExecutor";
import { CHAT_STATUS } from "./constants";
import { saveActiveChat } from "./activeChatStorage";

/**
 * @param {Object}   deps                           All state and refs needed by the side effects
 * @param {Array}    deps.messages                  Chat messages array
 * @param {Object}   deps.messagesRef               Ref kept in sync with messages
 * @param {Object}   deps.conversationHistoryRef    Ref to the model-visible history (for persistence)
 * @param {string}   deps.status                    Current chat status
 * @param {Array}    deps.executedTools             Executed tools array
 * @param {Object}   deps.executedToolsRef          Ref to executed tools
 * @param {boolean}  deps.isSaving                  Whether a save is in progress
 * @param {boolean}  deps.isSavingPost              WordPress isSavingPost selector
 * @param {Function} deps.setMessages               Messages state setter
 * @param {Function} deps.setExecutedTools          Executed tools state setter
 * @param {Function} deps.setHasGlobalStylesChanges Global styles change flag setter
 * @param {Function} deps.setIsSaving               Saving state setter
 */
const useChatSideEffects = ({
	messages,
	messagesRef,
	conversationHistoryRef,
	status,
	executedTools,
	executedToolsRef,
	isSaving,
	isSavingPost,
	setMessages,
	setExecutedTools,
	setHasGlobalStylesChanges,
	setIsSaving,
}) => {
	// Keep messagesRef in sync
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages, messagesRef]);

	// Keep executedToolsRef in sync
	useEffect(() => {
		if (executedTools.length > 0) {
			executedToolsRef.current = executedTools;
		}
	}, [executedTools, executedToolsRef]);

	// Flush executed tools into messages when idle
	useEffect(() => {
		if (status === CHAT_STATUS.IDLE && executedTools.length > 0) {
			upsertToolExecMsg(setMessages, executedTools);
			executedToolsRef.current = [...executedTools];
			setExecutedTools([]);
		}
	}, [status, executedTools, setMessages, setExecutedTools, executedToolsRef]);

	// Watch for save completion
	useEffect(() => {
		if (isSaving && !isSavingPost) {
			setMessages((prev) =>
				prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions: _hasActions, undoData: _undoData, ...rest } = msg;
						return rest;
					}
					return msg;
				})
			);
			setHasGlobalStylesChanges(false);
			setIsSaving(false);
		}
	}, [isSaving, isSavingPost, setMessages, setHasGlobalStylesChanges, setIsSaving]);

	// Persist active chat so a page reload can resume where we left off.
	// conversationHistoryRef is mutated by chatLoop BEFORE setMessages fires,
	// so by the time this effect runs, the ref already reflects the new turn.
	// Skip the initial mount: the effect would otherwise rewrite savedAt to
	// "now" on every page load and effectively disable the TTL.
	const isInitialMountRef = useRef(true);
	useEffect(() => {
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false;
			return;
		}
		saveActiveChat(messages, conversationHistoryRef.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps -- ref deliberately omitted; see note above
	}, [messages]);
};

export default useChatSideEffects;
