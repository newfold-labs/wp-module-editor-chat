/**
 * useConversationSync — keeps the server-side conversation row in sync with
 * local chat state. The row is created on the first user message of a new
 * chat, then updated with a debounced PUT (~1 s) whenever messages change.
 * Never writes while read-only (viewing a past chat), and never blocks the UI:
 * failures are logged and retried on the next change.
 *
 * Every save works from a snapshot taken when it fires (or is flushed), so a
 * save that is still in flight when the user switches conversation keeps
 * writing to the conversation it belongs to, never to the one opened since.
 */
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";

import { createConversation, updateConversation } from "../../services/conversationsApi";
import {
	getCurrentPageModified,
	getCurrentPageType,
	getCurrentStoredPageId,
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
 * @return {{conversationId: (number|null), conversationPostIdRef: {current: (number|null)}, setConversationId: Function, readOnly: boolean, setReadOnly: Function, suppressNextSync: Function, flushPending: Function, resetSync: Function}} Sync state and controls.
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
	// The not-yet-fired save, so it can be flushed instead of lost.
	const pendingRef = useRef(null);
	const isInitialMountRef = useRef(true);
	const suppressNextRef = useRef(false);
	// Saves run one at a time so two of them can never both create a row.
	const saveChainRef = useRef(Promise.resolve());
	// Bumped whenever the active conversation is switched from outside, so a
	// save that started before the switch never adopts or clears the new id.
	const epochRef = useRef(0);
	const onChangeRef = useRef(onConversationChange);
	onChangeRef.current = onConversationChange;

	useEffect(() => {
		readOnlyRef.current = readOnly;
	}, [readOnly]);

	const applyConversationId = useCallback((id, postId = null) => {
		conversationIdRef.current = id;
		conversationPostIdRef.current = id ? postId : null;
		setConversationIdState(id);
	}, []);

	// External switch (resume, migration): invalidates any save started earlier.
	const setConversationId = useCallback(
		(id, postId = null) => {
			epochRef.current += 1;
			applyConversationId(id, postId);
		},
		[applyConversationId]
	);

	const suppressNextSync = useCallback(() => {
		suppressNextRef.current = true;
	}, []);

	const flushPending = useCallback(() => {
		if (!pendingRef.current) {
			return;
		}
		clearTimeout(timerRef.current);
		const fire = pendingRef.current;
		pendingRef.current = null;
		fire();
	}, []);

	const resetSync = useCallback(() => {
		// The last change of the chat being left must still reach its own row.
		flushPending();
		epochRef.current += 1;
		suppressNextRef.current = false;
		applyConversationId(null);
		setReadOnly(false);
	}, [flushPending, applyConversationId]);

	const runSave = useCallback(
		async (snapshot) => {
			const { epoch } = snapshot;
			try {
				let id = epoch === epochRef.current ? conversationIdRef.current : snapshot.id;
				let boundPostId =
					epoch === epochRef.current ? conversationPostIdRef.current : snapshot.boundPostId;

				if (!id) {
					const created = await createConversation({
						postId: snapshot.pageId,
						postType: snapshot.postType,
						postModifiedSeenAt: snapshot.modified,
					});
					id = created.id;
					boundPostId = snapshot.pageId;
					// Adopt the new row only if nothing switched conversation meanwhile;
					// either way this chat's messages still go into the row made for it.
					if (epoch === epochRef.current) {
						applyConversationId(id, snapshot.pageId);
						onChangeRef.current?.(id, snapshot.pageId);
					}
				}

				const payload = { messages: snapshot.messages, history: snapshot.history };
				// Only advance the drift watermark from the page the chat is bound to.
				if (snapshot.pageId === boundPostId) {
					payload.postModifiedSeenAt = snapshot.modified;
				}
				await updateConversation(id, payload);
			} catch (err) {
				if (epoch !== epochRef.current) {
					return;
				}
				if (err?.data?.status === 404) {
					// Deleted elsewhere: stop updating it; the next message starts a new row.
					applyConversationId(null);
					onChangeRef.current?.(null, null);
					return;
				}
				logger.warn("[EditorChat] Conversation sync failed, will retry on next change:", err);
			}
		},
		[applyConversationId]
	);

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

		const fire = () => {
			// The Site Editor resolves the current post asynchronously, and
			// templates have no numeric id: without a post there is nothing to bind to.
			const pageId = getCurrentStoredPageId();
			if (!pageId || readOnlyRef.current) {
				return;
			}
			const snapshot = {
				epoch: epochRef.current,
				id: conversationIdRef.current,
				boundPostId: conversationPostIdRef.current,
				pageId,
				postType: getCurrentPageType(),
				modified: getCurrentPageModified(),
				messages,
				history: [...conversationHistoryRef.current],
			};
			saveChainRef.current = saveChainRef.current.then(() => runSave(snapshot));
		};

		pendingRef.current = fire;
		timerRef.current = setTimeout(() => {
			pendingRef.current = null;
			fire();
		}, DEBOUNCE_MS);

		return () => {
			clearTimeout(timerRef.current);
			pendingRef.current = null;
		};
		// conversationHistoryRef is a ref and is read when the save fires, on purpose.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [messages, runSave]);

	return {
		conversationId,
		conversationPostIdRef,
		setConversationId,
		readOnly,
		setReadOnly,
		suppressNextSync,
		flushPending,
		resetSync,
	};
};

export default useConversationSync;
