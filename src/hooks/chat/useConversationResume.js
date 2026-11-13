/**
 * useConversationResume — opens a stored conversation from history and owns
 * the state around resuming it: the different-page prompt, the drift banner
 * and the "page no longer exists" note. The chat state itself is applied
 * through callbacks, so this hook stays independent of the chat hook.
 */
import { useCallback, useState } from "@wordpress/element";

import { deleteConversation, getConversation } from "../../services/conversationsApi";
import { getDriftInfo, hydrateConversation, resolveResumeMode } from "./resumeConversation";

/**
 * @param {Object}   deps                    Hook dependencies.
 * @param {Function} deps.getCurrentPostId   () => number, post open in the editor.
 * @param {Function} deps.getCurrentModified () => string, its last-modified timestamp.
 * @param {Function} deps.onHydrate          ({messages, history, conversation}) => void, applies the chat state.
 * @param {Function} deps.navigate           (postType, postId) => void, opens another page.
 * @param {Function} deps.onDeleted          () => void, called after a conversation was deleted.
 * @param {Object}   deps.sync               The conversation sync controls (setConversationId, setReadOnly, suppressNextSync, flushPending).
 * @param {Function} [deps.isBusy]           () => boolean, true while a turn is running; resuming is refused then.
 * @return {{pageConflict: (Object|null), driftInfo: (Object|null), resumedPostMissing: boolean, openConversation: Function, resolvePageConflict: Function, dismissDrift: Function, resetResume: Function, deleteConversationById: Function}} Resume state and actions.
 */
const useConversationResume = ({
	getCurrentPostId,
	getCurrentModified,
	onHydrate,
	navigate,
	onDeleted,
	sync,
	isBusy = () => false,
}) => {
	const [pageConflict, setPageConflict] = useState(null); // { conversation } | null
	const [driftInfo, setDriftInfo] = useState(null); // { seenAt } | null
	const [resumedPostMissing, setResumedPostMissing] = useState(false);

	const applyConversation = useCallback(
		(conversation, { readOnly }) => {
			const { messages, history } = hydrateConversation(conversation);
			// The chat being left must still get its last change saved to its own row.
			sync.flushPending();
			// Hydrating messages would otherwise trigger an immediate save that
			// only reorders the history list.
			sync.suppressNextSync();
			onHydrate({ messages, history, conversation });
			sync.setConversationId(conversation.id, conversation.post_id);
			sync.setReadOnly(readOnly);
			setResumedPostMissing(!conversation.post_exists);
			setDriftInfo(getDriftInfo({ conversation, currentModified: getCurrentModified() }));
		},
		[sync, onHydrate, getCurrentModified]
	);

	const openConversation = useCallback(
		async (item) => {
			if (isBusy()) {
				return;
			}
			const conversation = await getConversation(item.id);
			const mode = resolveResumeMode({ conversation, currentPostId: getCurrentPostId() });

			if (mode === "conflict") {
				setPageConflict({ conversation });
				return;
			}
			applyConversation(conversation, { readOnly: mode === "readonly-missing" });
		},
		[applyConversation, getCurrentPostId, isBusy]
	);

	const resolvePageConflict = useCallback(
		(action) => {
			// Replacing the chat mid-turn would corrupt the running turn.
			if (!pageConflict || isBusy()) {
				return;
			}
			const { conversation } = pageConflict;
			setPageConflict(null);
			if (action === "navigate") {
				navigate(conversation.post_type, conversation.post_id);
				return;
			}
			applyConversation(conversation, { readOnly: true });
		},
		[pageConflict, applyConversation, navigate, isBusy]
	);

	const dismissDrift = useCallback(() => setDriftInfo(null), []);

	const resetResume = useCallback(() => {
		setPageConflict(null);
		setDriftInfo(null);
		setResumedPostMissing(false);
	}, []);

	const deleteConversationById = useCallback(
		async (id) => {
			await deleteConversation(id);
			onDeleted();
		},
		[onDeleted]
	);

	return {
		pageConflict,
		driftInfo,
		resumedPostMissing,
		openConversation,
		resolvePageConflict,
		dismissDrift,
		resetResume,
		deleteConversationById,
	};
};

export default useConversationResume;
