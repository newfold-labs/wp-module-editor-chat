/**
 * useConversationSync — keeps the server-side conversation row in sync with
 * local chat state. Auto-creates the row on the first user message of a new
 * chat, then debounces a PUT (~1s) on every subsequent messages change.
 * Never writes while readOnly (viewing a past chat against a different,
 * live page — see the history-resume flow).
 */
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";

import {
	createConversation as apiCreateConversation,
	updateConversation as apiUpdateConversation,
} from "../../services/conversationsApi";
import {
	getCurrentPageId,
	getCurrentPageType,
	getCurrentPageModified,
} from "../../utils/editorHelpers";
import logger from "../../utils/logger";

const DEBOUNCE_MS = 1000;

/**
 * @param {Object}      deps                         Hook dependencies
 * @param {Array}       deps.messages                Chat messages array (triggers the debounce)
 * @param {Object}      deps.conversationHistoryRef  Ref to the model-visible history (sent alongside messages)
 * @param {number|null} [deps.initialConversationId] Conversation id restored from the local fallback cache, if any — avoids re-creating a row after a page reload.
 * @param {Function}    [deps.onConversationCreated] (id, postId) => void, called right after an auto-create succeeds
 * @return {{conversationId: (number|null), setConversationId: Function, readOnly: boolean, setReadOnly: Function, resetSync: Function}} Sync state and controls.
 */
const useConversationSync = ({
	messages,
	conversationHistoryRef,
	initialConversationId = null,
	onConversationCreated,
}) => {
	const [conversationId, setConversationIdState] = useState(initialConversationId);
	const [readOnly, setReadOnly] = useState(false);

	const conversationIdRef = useRef(initialConversationId);
	const readOnlyRef = useRef(false);
	const debounceTimerRef = useRef(null);
	const isInitialMountRef = useRef(true);

	const setConversationId = useCallback((id) => {
		conversationIdRef.current = id;
		setConversationIdState(id);
	}, []);

	useEffect(() => {
		readOnlyRef.current = readOnly;
	}, [readOnly]);

	const resetSync = useCallback(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}
		setConversationId(null);
		setReadOnly(false);
	}, [setConversationId]);

	useEffect(() => {
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false;
			return;
		}
		if (readOnlyRef.current || messages.length === 0) {
			return;
		}

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(async () => {
			try {
				let id = conversationIdRef.current;
				if (!id) {
					const postId = getCurrentPageId();
					const created = await apiCreateConversation({
						postId,
						postType: getCurrentPageType(),
						postModifiedSeenAt: getCurrentPageModified(),
					});
					id = created.id;
					setConversationId(id);
					onConversationCreated?.(id, postId);
				}
				await apiUpdateConversation(id, {
					messages,
					history: conversationHistoryRef.current,
					postModifiedSeenAt: getCurrentPageModified(),
				});
			} catch (err) {
				logger.warn("[EditorChat] Conversation sync failed, will retry on next change:", err);
			}
		}, DEBOUNCE_MS);

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- conversationHistoryRef is a ref, intentionally omitted
	}, [messages, setConversationId]);

	return { conversationId, setConversationId, readOnly, setReadOnly, resetSync };
};

export default useConversationSync;
