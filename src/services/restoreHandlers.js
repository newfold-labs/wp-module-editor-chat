/**
 * Undo / restore handlers — invoked when the user clicks Decline on a
 * tool execution message to revert applied block and global-style changes.
 */
import { parse } from "@wordpress/blocks";
import { store as coreStore } from "@wordpress/core-data";
import { dispatch, select } from "@wordpress/data";

import { createBlockFromParsed } from "../utils/blockUtils";
import { updateTemplatePartContent } from "./templatePartEditor";

/**
 * Restore blocks to their previous state.
 *
 * @param {Array} undoData Array of original block states.
 * @return {Promise<Object>} Result of the restore operation.
 */
export async function restoreBlocks(undoData) {
	if (!undoData || !Array.isArray(undoData)) {
		return { success: false, message: "No undo data available" };
	}

	const { updateBlockAttributes, replaceInnerBlocks } = dispatch("core/block-editor");
	const { getBlock } = select("core/block-editor");
	const results = [];
	const errors = [];

	for (const blockData of undoData) {
		try {
			const {
				clientId,
				attributes,
				innerBlocks,
				isTemplatePart: isTemplatePartBlock,
				entityContent,
			} = blockData;

			if (!clientId) {
				errors.push("Missing clientId in undo data");
				continue;
			}

			if (isTemplatePartBlock && entityContent) {
				const block = getBlock(clientId);
				if (block) {
					const contentString =
						typeof entityContent === "string"
							? entityContent
							: entityContent.raw || entityContent.rendered;

					if (contentString) {
						const originalBlocks = parse(contentString);
						const updateResult = await updateTemplatePartContent(block, originalBlocks);

						if (!updateResult.success) {
							// eslint-disable-next-line no-console
							console.warn("Failed to restore template part entity:", updateResult.message);
							errors.push(`Template part entity restore failed: ${updateResult.message}`);
						}

						const restoredInnerBlocks = originalBlocks.map((inner) => createBlockFromParsed(inner));
						replaceInnerBlocks(clientId, restoredInnerBlocks);
					} else {
						// eslint-disable-next-line no-console
						console.error("No content string to restore for template part");
					}
				} else {
					// eslint-disable-next-line no-console
					console.error("Could not find block with clientId:", clientId);
				}
			} else {
				updateBlockAttributes(clientId, attributes);

				if (innerBlocks && Array.isArray(innerBlocks)) {
					const restoredInnerBlocks = innerBlocks.map((inner) => createBlockFromParsed(inner));
					replaceInnerBlocks(clientId, restoredInnerBlocks);
				}
			}

			const messageType = isTemplatePartBlock ? "Template part" : "Block";
			results.push({
				clientId,
				message: `${messageType} restored successfully`,
			});
		} catch (error) {
			errors.push(`Failed to restore block: ${error.message}`);
			// eslint-disable-next-line no-console
			console.error("Failed to restore block:", error);
		}
	}

	return {
		success: errors.length === 0,
		message:
			errors.length === 0 ? "All blocks restored successfully" : "Some blocks failed to restore",
		results,
		errors,
	};
}

/**
 * Restore global styles to their previous state.
 *
 * @param {Object} undoData Object containing originalStyles and globalStylesId.
 * @return {Promise<Object>} Result of the restore operation.
 */
export async function restoreGlobalStyles(undoData) {
	if (!undoData || !undoData.originalStyles || !undoData.globalStylesId) {
		return { success: false, message: "No undo data available for global styles" };
	}

	const { originalStyles, globalStylesId } = undoData;
	const { editEntityRecord } = dispatch(coreStore);

	try {
		editEntityRecord("root", "globalStyles", globalStylesId, {
			settings: originalStyles,
		});

		return {
			success: true,
			message: "Global styles restored successfully",
		};
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Failed to restore global styles:", error);
		return {
			success: false,
			message: `Failed to restore global styles: ${error.message}`,
		};
	}
}
