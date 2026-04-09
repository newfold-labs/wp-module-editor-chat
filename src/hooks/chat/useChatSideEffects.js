/**
 * useChatSideEffects — Manages all side effects for the editor chat hook.
 *
 * Consolidates ref syncing, tool lifecycle, save watching,
 * and conversation persistence into a single hook.
 */
import { useEffect } from "@wordpress/element";
import { archiveConversation } from "@newfold-labs/wp-module-ai-chat";

import { upsertToolExecMsg } from "../../services/toolExecutor";
import { CHAT_STATUS, EDITOR_CHAT_CONSUMER } from "./constants";
import { hasMeaningfulUserMessage } from "./conversationUtils";

/**
 * @param {Object}   deps                           All state and refs needed by the side effects
 * @param {Array}    deps.messages                  Chat messages array
 * @param {Object}   deps.messagesRef               Ref to messages for unload handler
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

	// Archive conversation while chatting
	useEffect(() => {
		if (hasMeaningfulUserMessage(messages)) {
			archiveConversation(messages, null, null, EDITOR_CHAT_CONSUMER);
		}
	}, [messages]);

	// Archive on unload
	useEffect(() => {
		const handleBeforeUnload = () => {
			if (hasMeaningfulUserMessage(messagesRef.current)) {
				archiveConversation(messagesRef.current, null, null, EDITOR_CHAT_CONSUMER);
			}
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [messagesRef]);
};

export default useChatSideEffects;
