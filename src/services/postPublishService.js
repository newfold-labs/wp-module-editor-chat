/**
 * Publish helpers aligned with Gutenberg PostPublishButton status logic.
 */
import { select } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";

import { saveDirtyEditorEntities } from "./entitySaveService";

/**
 * Target post status when promoting a draft to published.
 *
 * @param {Function} editorSelect core/editor select function.
 * @return {string} WordPress post status slug.
 */
export function getPublishStatusForDraft(editorSelect) {
	const store = editorSelect(editorStore);
	const hasPublishAction = !!store.getCurrentPost()?._links?.["wp:action-publish"];

	if (!hasPublishAction) {
		return "pending";
	}

	if (store.getEditedPostVisibility() === "private") {
		return "private";
	}

	if (store.isEditedPostBeingScheduled()) {
		return "future";
	}

	return "publish";
}

/**
 * Whether the edited post should be promoted from draft/auto-draft on publish.
 *
 * @param {Function} editorSelect core/editor select function.
 * @return {boolean} True when the post should be promoted from draft.
 */
export function shouldPromoteDraftToPublished(editorSelect) {
	const store = editorSelect(editorStore);

	if (store.isCurrentPostPublished()) {
		return false;
	}

	const status = store.getEditedPostAttribute("status");
	return status === "draft" || status === "auto-draft";
}

/**
 * Save dirty entities, promote draft to published when needed, then save the post.
 *
 * @param {Object}   options
 * @param {Function} options.editPost               core/editor editPost dispatcher.
 * @param {Function} options.savePost               core/editor savePost dispatcher.
 * @param {Function} options.saveEditedEntityRecord core-data saveEditedEntityRecord dispatcher.
 * @return {Promise<void>}
 */
export async function publishEditedPost({ editPost, savePost, saveEditedEntityRecord }) {
	await saveDirtyEditorEntities(saveEditedEntityRecord);

	if (shouldPromoteDraftToPublished(select)) {
		const status = getPublishStatusForDraft(select);
		editPost({ status }, { undoIgnore: true });
	}

	await savePost();
}
