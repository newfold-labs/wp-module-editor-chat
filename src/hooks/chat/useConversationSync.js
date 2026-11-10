/**
 * useConversationSync — keeps the server-side conversation row in sync with
 * local chat state. The row is created on the first user message of a new
 * chat, then updated with a debounced PUT (~1 s) whenever messages change.
 * Never writes while read-only (viewing a past chat), and never blocks the UI:
 * failures are logged and retried on the next change.
 */
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";

import { createConversation, updateConversation } from "../../services/conversationsApi";
import {
	getCurrentPageId,
	getCurrentPageModified,
	getCurrentPageType,
} from "../../utils/editorHelpers";
import logger from "../../utils/logger";

const DEBOUNCE_MS = 1000;

/**
 * @param {Object}      deps                         Hook dependencies.
 * @param {Array}       deps.messages                Chat messages (a change triggers the debounce).
 * @param {Object}      deps.conversationHistoryRef  Ref to the model-visible history, saved alongside messages.
 * @param {number|null} [deps.initialConversationId] Id restored from the local fallback cache.
 * @param {number|null} [deps.initialPostId]         Post that conversation is bound to.
 * @param {Function}    [deps.onConversationChange]  (id|null, postId|null) => void, after the id is created or dropped.
 * @return {{conversationId: (number|null), conversationPostIdRef: {current: (number|null)}, setConversationId: Function, readOnly: boolean, setReadOnly: Function, suppressNextSync: Function, resetSync: Function}} Sync state and controls.
 */
const useConversationSync = ({
	messages,
	conversationHistoryRef,
	initialConversationId = null,
	initialPostId = null,
	onConversationChange,
}) => {
	const [conversationId, setConversationIdState] = useState(initialConversationId);
	const [readOnly, setReadOnly] = useState(false);

	const conversationIdRef = useRef(initialConversationId);
	const conversationPostIdRef = useRef(initialPostId);
	const readOnlyRef = useRef(false);
	const timerRef = useRef(null);
	const isInitialMountRef = useRef(true);
	const suppressNextRef = useRef(false);
	// Saves run one at a time so two timers can never both create a row.
	const saveChainRef = useRef(Promise.resolve());
	// Bumped by resetSync so an in-flight create never revives a discarded chat.
	const epochRef = useRef(0);
	const onChangeRef = useRef(onConversationChange);
	onChangeRef.current = onConversationChange;

	useEffect(() => {
		readOnlyRef.current = readOnly;
	}, [readOnly]);

	const setConversationId = useCallback((id, postId = null) => {
		conversationIdRef.current = id;
		conversationPostIdRef.current = id ? postId : null;
		setConversationIdState(id);
	}, []);

	const suppressNextSync = useCallback(() => {
		suppressNextRef.current = true;
	}, []);

	const resetSync = useCallback(() => {
		clearTimeout(timerRef.current);
		epochRef.current += 1;
		suppressNextRef.current = false;
		setConversationId(null);
		setReadOnly(false);
	}, [setConversationId]);

	useEffect(() => {
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false;
			return undefined;
		}
		if (suppressNextRef.current) {
			suppressNextRef.current = false;
			return undefined;
		}
		if (readOnlyRef.current || messages.length === 0) {
			return undefined;
		}

		const save = async () => {
			const epoch = epochRef.current;
			// The Site Editor resolves the current post asynchronously; without a
			// page there is nothing to bind the conversation to.
			const pageId = getCurrentPageId();
			if (!pageId || readOnlyRef.current) {
				return;
			}
			try {
				let id = conversationIdRef.current;
				if (!id) {
					const created = await createConversation({
						postId: pageId,
						postType: getCurrentPageType(),
						postModifiedSeenAt: getCurrentPageModified(),
					});
					if (epoch !== epochRef.current) {
						return;
					}
					id = created.id;
					setConversationId(id, pageId);
					onChangeRef.current?.(id, pageId);
				}
				const payload = { messages, history: conversationHistoryRef.current };
				// Only advance the drift watermark from the page the chat is bound to.
				if (getCurrentPageId() === conversationPostIdRef.current) {
					payload.postModifiedSeenAt = getCurrentPageModified();
				}
				await updateConversation(id, payload);
			} catch (err) {
				if (epoch !== epochRef.current) {
					return;
				}
				if (err?.data?.status === 404) {
					// Deleted elsewhere: stop updating it; the next message starts a new row.
					setConversationId(null);
					onChangeRef.current?.(null, null);
					return;
				}
				logger.warn("[EditorChat] Conversation sync failed, will retry on next change:", err);
			}
		};

		timerRef.current = setTimeout(() => {
			saveChainRef.current = saveChainRef.current.then(save);
		}, DEBOUNCE_MS);

		return () => clearTimeout(timerRef.current);
		// conversationHistoryRef is a ref and is read at save time on purpose.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [messages, setConversationId]);

	return {
		conversationId,
		conversationPostIdRef,
		setConversationId,
		readOnly,
		setReadOnly,
		suppressNextSync,
		resetSync,
	};
};

export default useConversationSync;
