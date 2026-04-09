/* eslint-disable no-undef, no-console */
/**
 * useChangeActions — Accept and decline change handlers for editor chat.
 *
 * Handles saving global styles, template parts, and posts on accept,
 * and restoring blocks/styles from undo data on decline.
 */
import { useCallback } from "@wordpress/element";

import { restoreBlocks, restoreGlobalStyles } from "../../services/actionExecutor";

/**
 * @param {Object}   deps                                        State, setters, refs, and WordPress dispatchers
 * @param {Array}    deps.messages                               Chat messages array
 * @param {Function} deps.setMessages                            Messages state setter
 * @param {Function} deps.setIsSaving                            Saving state setter
 * @param {Function} deps.setHasGlobalStylesChanges              Global styles change flag setter
 * @param {boolean}  deps.hasGlobalStylesChanges                 Whether global styles were modified
 * @param {Object}   deps.originalGlobalStylesRef                Ref to original global styles
 * @param {Object}   deps.blockSnapshotRef                       Ref to block snapshot for undo
 * @param {Function} deps.savePost                               WordPress savePost dispatcher
 * @param {Function} deps.saveEditedEntityRecord                 WordPress entity save dispatcher
 * @param {Function} deps.__experimentalGetCurrentGlobalStylesId Global styles ID selector
 * @return {{ handleAcceptChanges: Function, handleDeclineChanges: Function }} Change action handlers
 */
const useChangeActions = ({
	messages,
	setMessages,
	setIsSaving,
	setHasGlobalStylesChanges,
	hasGlobalStylesChanges,
	originalGlobalStylesRef,
	blockSnapshotRef,
	savePost,
	saveEditedEntityRecord,
	__experimentalGetCurrentGlobalStylesId,
}) => {
	// eslint-disable-next-line no-unused-vars -- wired up via ChatMessages action buttons
	const handleAcceptChanges = useCallback(async () => {
		setIsSaving(true);

		if (hasGlobalStylesChanges) {
			try {
				const globalStylesId = __experimentalGetCurrentGlobalStylesId
					? __experimentalGetCurrentGlobalStylesId()
					: undefined;
				if (globalStylesId) {
					await saveEditedEntityRecord("root", "globalStyles", globalStylesId);
				}
				originalGlobalStylesRef.current = null;
			} catch (saveError) {
				console.error("Error saving global styles:", saveError);
			}
		}

		// Save dirty template-part entities
		try {
			const coreSelect = wp.data.select("core");
			const getDirtyRecords =
				coreSelect.__experimentalGetDirtyEntityRecords || coreSelect.getDirtyEntityRecords;
			if (getDirtyRecords) {
				const allDirty = getDirtyRecords();
				const dirtyTemplateParts = allDirty.filter(
					(r) => r.kind === "postType" && r.name === "wp_template_part"
				);
				for (const record of dirtyTemplateParts) {
					await saveEditedEntityRecord("postType", "wp_template_part", record.key);
				}
			}
		} catch (tpError) {
			console.error("[TP-SAVE] Error saving template parts:", tpError);
		}

		blockSnapshotRef.current = null;

		// Notify the AI that changes were accepted
		setMessages((prev) => [
			...prev,
			{
				id: `notification-${Date.now()}`,
				type: "notification",
				content: "The user accepted and saved all the changes you made.",
			},
		]);

		if (savePost) {
			savePost();
		}
	}, [
		hasGlobalStylesChanges,
		__experimentalGetCurrentGlobalStylesId,
		saveEditedEntityRecord,
		savePost,
		setIsSaving,
		setMessages,
		originalGlobalStylesRef,
		blockSnapshotRef,
	]);

	// eslint-disable-next-line no-unused-vars -- wired up via ChatMessages action buttons
	const handleDeclineChanges = useCallback(async () => {
		const firstActionMessage = messages.find((msg) => msg.hasActions && msg.undoData);

		if (!firstActionMessage || !firstActionMessage.undoData) {
			console.error("No undo data available");
			return;
		}

		try {
			const undoData = firstActionMessage.undoData;

			if (undoData && typeof undoData === "object" && !Array.isArray(undoData)) {
				if (undoData.blocks && Array.isArray(undoData.blocks) && undoData.blocks.length > 0) {
					const { dispatch: wpDispatch } = wp.data;
					const { createBlock: wpCreateBlock } = wp.blocks;

					const restoreBlock = (parsed) => {
						const innerBlocks = parsed.innerBlocks
							? parsed.innerBlocks.map((inner) => restoreBlock(inner))
							: [];
						return wpCreateBlock(parsed.name, parsed.attributes || {}, innerBlocks);
					};
					const restoredBlocks = undoData.blocks.map((b) => restoreBlock(b));
					wpDispatch("core/block-editor").resetBlocks(restoredBlocks);
				}
				if (
					undoData.globalStyles &&
					undoData.globalStyles.originalStyles &&
					undoData.globalStyles.globalStylesId
				) {
					await restoreGlobalStyles(undoData.globalStyles);
				}
			} else if (Array.isArray(undoData)) {
				await restoreBlocks(undoData);
			}

			setMessages((prev) => [
				...prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions: _hasActions, undoData: _msgUndoData, ...rest } = msg;
						return rest;
					}
					return msg;
				}),
				{
					id: `notification-${Date.now()}`,
					type: "notification",
					content:
						"The user declined the changes. All modifications have been reverted to their previous state.",
				},
			]);

			setHasGlobalStylesChanges(false);
			originalGlobalStylesRef.current = null;
			blockSnapshotRef.current = null;
		} catch (restoreError) {
			console.error("Error restoring changes:", restoreError);
		}
	}, [messages, setMessages, setHasGlobalStylesChanges, originalGlobalStylesRef, blockSnapshotRef]);

	return { handleAcceptChanges, handleDeclineChanges };
};

export default useChangeActions;
