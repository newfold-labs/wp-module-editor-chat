/**
 * conversationsApi — thin REST client for server-side chat persistence.
 * All calls go through @wordpress/api-fetch (handles the REST nonce
 * automatically in the admin/editor context, same as useSessionConfig.js).
 */
import apiFetch from "@wordpress/api-fetch";

const BASE = "/nfd-editor-chat/v1/conversations";

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

export const getConversation = (id) => apiFetch({ path: `${BASE}/${id}` });

export const updateConversation = (id, { messages, history, postModifiedSeenAt }) =>
	apiFetch({
		path: `${BASE}/${id}`,
		method: "PUT",
		data: {
			messages: { messages, history: history || [] },
			...(postModifiedSeenAt ? { post_modified_seen_at: postModifiedSeenAt } : {}),
		},
	});

export const deleteConversation = (id) => apiFetch({ path: `${BASE}/${id}`, method: "DELETE" });

export const listConversations = ({ limit = 20, cursor = null } = {}) => {
	const query = new URLSearchParams({ limit: String(limit) });
	if (cursor) {
		query.set("cursor", cursor);
	}
	return apiFetch({ path: `${BASE}?${query.toString()}` });
};
