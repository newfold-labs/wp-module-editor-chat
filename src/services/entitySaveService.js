/**
 * Persist dirty template-part and navigation-menu entity edits.
 *
 * wp_navigation menus edited entity-first (navigationEditor.js) must be saved
 * explicitly — savePost() does not persist them, and dirty detection can miss
 * edits when content is stored as { raw } vs a plain string.
 */
import { select } from "@wordpress/data";

import {
	clearTouchedNavigationEntityIds,
	getTouchedNavigationEntityIds,
} from "./navigationEditor";

const EDITABLE_ENTITY_TYPES = ["wp_template_part", "wp_navigation"];

/**
 * Save all pending template-part and navigation entity edits.
 *
 * @param {Function} saveEditedEntityRecord core-data saveEditedEntityRecord dispatcher.
 * @return {Promise<void>}
 */
export async function saveDirtyEditorEntities(saveEditedEntityRecord) {
	const coreSelect = select("core");
	const getDirtyRecords =
		coreSelect.__experimentalGetDirtyEntityRecords || coreSelect.getDirtyEntityRecords;

	const savedKeys = new Set();

	if (getDirtyRecords) {
		const dirty = getDirtyRecords().filter(
			(r) => r.kind === "postType" && EDITABLE_ENTITY_TYPES.includes(r.name)
		);
		for (const record of dirty) {
			await saveEditedEntityRecord("postType", record.name, record.key);
			savedKeys.add(`${record.name}:${record.key}`);
		}
	}

	// Entity-first navigation edits always mark the menu ID; save even when
	// core-data did not flag the record dirty.
	for (const entityId of getTouchedNavigationEntityIds()) {
		const key = `wp_navigation:${entityId}`;
		if (!savedKeys.has(key)) {
			await saveEditedEntityRecord("postType", "wp_navigation", entityId);
		}
	}

	clearTouchedNavigationEntityIds();
}
