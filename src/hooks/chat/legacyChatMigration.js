/**
 * One-shot migration of the pre-server "active chat" kept in localStorage.
 *
 * The old model was a single rolling chat per site with no page association,
 * so the migrated row is attributed to the page open when the migration runs.
 * On any failure nothing is marked done, so the whole migration simply runs
 * again on the next load.
 */
import {
	createConversation as apiCreateConversation,
	updateConversation as apiUpdateConversation,
} from "../../services/conversationsApi";
import { clearActiveChat, loadActiveChat } from "./activeChatStorage";

export const MIGRATION_FLAG = "nfd-editor-chat-migrated";

const NOT_MIGRATED = Object.freeze({ migrated: false, conversationId: null });

/**
 * Push a legacy local chat to the server, then mark the migration done.
 *
 * @param {Object}  params                    Migration inputs.
 * @param {number}  params.postId             Post currently open in the editor (0 until it resolves).
 * @param {string}  params.postType           Its post type.
 * @param {string}  params.postModifiedSeenAt Its last-modified timestamp.
 * @param {Object}  [params.api]              API wrappers (injectable for tests).
 * @param {Storage} [params.storage]          Where the done-flag lives.
 * @return {Promise<{migrated: boolean, conversationId: (number|null)}>} What happened.
 */
export async function migrateLegacyChat({
	postId,
	postType,
	postModifiedSeenAt,
	api = { createConversation: apiCreateConversation, updateConversation: apiUpdateConversation },
	storage = window.localStorage,
}) {
	if (!postId || storage.getItem(MIGRATION_FLAG)) {
		return NOT_MIGRATED;
	}

	const legacy = loadActiveChat();
	if (legacy.messages.length === 0) {
		storage.setItem(MIGRATION_FLAG, "1");
		return NOT_MIGRATED;
	}

	const created = await api.createConversation({ postId, postType, postModifiedSeenAt });
	await api.updateConversation(created.id, {
		messages: legacy.messages,
		history: legacy.history,
		postModifiedSeenAt,
	});

	storage.setItem(MIGRATION_FLAG, "1");
	clearActiveChat();
	return { migrated: true, conversationId: created.id };
}
