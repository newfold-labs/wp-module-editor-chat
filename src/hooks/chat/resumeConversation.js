/**
 * Pure helpers for resuming a stored conversation: where it may be resumed,
 * whether the page drifted since, and turning the stored payload back into
 * chat state.
 */
import { normalizeStoredMessages } from "../../services/conversationsApi";
import { isModifiedNewer } from "../../utils/editorHelpers";

/**
 * Decide how a conversation opened from history can be resumed.
 *
 * @param {Object} params               Inputs.
 * @param {Object} params.conversation  Conversation from GET /conversations/{id}.
 * @param {number} params.currentPostId Post open in the editor.
 * @return {"readonly-missing"|"conflict"|"hydrate"} Resume mode.
 */
export function resolveResumeMode({ conversation, currentPostId }) {
	if (!conversation.post_exists) {
		return "readonly-missing";
	}
	if (conversation.post_id !== currentPostId) {
		return "conflict";
	}
	return "hydrate";
}

/**
 * Whether the page was edited after the chat last saw it.
 *
 * @param {Object} params                 Inputs.
 * @param {Object} params.conversation    Stored conversation.
 * @param {string} params.currentModified Current page-modified timestamp.
 * @return {{seenAt: string}|null} Drift info, or null when there is none.
 */
export function getDriftInfo({ conversation, currentModified }) {
	const seenAt = conversation.post_modified_seen_at;
	return isModifiedNewer(currentModified, seenAt) ? { seenAt } : null;
}

/**
 * Turn a stored conversation into chat state.
 *
 * @param {Object} conversation Conversation from the REST API.
 * @return {{messages: Array, history: Array}} Render-ready messages and model history.
 */
export function hydrateConversation(conversation) {
	const stored = conversation?.messages || {};
	return {
		messages: normalizeStoredMessages(stored.messages),
		history: Array.isArray(stored.history) ? stored.history : [],
	};
}
