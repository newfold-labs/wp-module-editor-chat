/**
 * REST client for server-side editor chat conversations
 * (`nfd-editor-chat/v1/conversations`).
 */
import apiFetch from "@wordpress/api-fetch";

const BASE = "/nfd-editor-chat/v1/conversations";

/**
 * Create an empty conversation bound to a page.
 *
 * @param {Object} params                    Page identity.
 * @param {number} params.postId             Post ID the chat belongs to.
 * @param {string} params.postType           Post type slug.
 * @param {string} params.postModifiedSeenAt "YYYY-MM-DD HH:MM:SS" the page was last modified at.
 * @return {Promise<{id: number}>} The new conversation id.
 */
export const createConversation = ({ postId, postType, postModifiedSeenAt }) =>
	apiFetch({
		path: BASE,
		method: "POST",
		data: {
			post_id: postId,
			post_type: postType,
			post_modified_seen_at: postModifiedSeenAt,
		},
	});

/**
 * Fetch one conversation including its stored messages and history.
 *
 * @param {number} id Conversation id.
 * @return {Promise<Object>} Full conversation.
 */
export const getConversation = (id) => apiFetch({ path: `${BASE}/${id}`, method: "GET" });

/**
 * Replace a conversation's messages and history.
 *
 * @param {number} id                           Conversation id.
 * @param {Object} payload                      Conversation payload.
 * @param {Array}  payload.messages             UI messages.
 * @param {Array}  payload.history              Model-visible history.
 * @param {string} [payload.postModifiedSeenAt] Advance the drift watermark.
 * @return {Promise<{id: number, updated_at: string}>} Save result.
 */
export const updateConversation = (id, { messages, history, postModifiedSeenAt }) => {
	const data = { messages, history };
	if (postModifiedSeenAt) {
		data.post_modified_seen_at = postModifiedSeenAt;
	}
	return apiFetch({ path: `${BASE}/${id}`, method: "PUT", data });
};

/**
 * Soft-delete a conversation.
 *
 * @param {number} id Conversation id.
 * @return {Promise<{id: number, deleted: boolean}>} Delete result.
 */
export const deleteConversation = (id) => apiFetch({ path: `${BASE}/${id}`, method: "DELETE" });

/**
 * List the current user's conversations (metadata only), newest first.
 *
 * @param {Object}      [options]        Pagination options.
 * @param {number}      [options.limit]  Page size (server caps at 20).
 * @param {string|null} [options.cursor] Opaque cursor from the previous page.
 * @return {Promise<{items: Array, next_cursor: (string|null)}>} One page.
 */
export const listConversations = ({ limit = 20, cursor = null } = {}) => {
	let path = `${BASE}?limit=${limit}`;
	if (cursor) {
		path += `&cursor=${encodeURIComponent(cursor)}`;
	}
	return apiFetch({ path, method: "GET" });
};

/**
 * Turn stored UI messages back into render-ready messages: timestamps become
 * Dates again and transient UI-only fields are dropped.
 *
 * @param {Array} messages Messages as stored on the server.
 * @return {Array} Render-ready messages.
 */
export const normalizeStoredMessages = (messages) => {
	if (!Array.isArray(messages)) {
		return [];
	}
	return messages.map(
		// eslint-disable-next-line no-unused-vars -- destructured only to drop the transient fields
		({ hasActions, undoData, isStreaming, ...rest }) => {
			if (typeof rest.timestamp === "string") {
				return { ...rest, timestamp: new Date(rest.timestamp) };
			}
			return rest;
		}
	);
};
