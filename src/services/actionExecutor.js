/**
 * WordPress dependencies
 */
import { dispatch, select } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { parse } from "@wordpress/blocks";

/**
 * Internal dependencies
 */
import {
	isTemplatePart,
	updateTemplatePartContent,
	findAncestorTemplatePart,
	getBlockPathInTemplatePart,
	modifyTemplatePartEntity,
	replaceBlockAtPath,
	insertBlocksAtPath,
	removeBlockAtPath,
	applyTemplatePartRewrite,
	handleDeleteTemplatePart,
} from "./templatePartEditor";
import {
	createBlockFromParsed,
	getEffectiveRootBlocks,
	findBlockContext,
} from "../utils/blockUtils";

/**
 * Block editing functions for the AI chat.
 *
 * Template-part-specific logic lives in templatePartEditor.js;
 * shared helpers live in blockUtils.js.
 */

// ────────────────────────────────────────────────────────────────
// Block CRUD operations
// ────────────────────────────────────────────────────────────────

/**
 * Replace entire block content.
 *
 * @param {string} clientId     The block's client ID.
 * @param {string} blockContent The new block content HTML.
 * @return {Promise<Object>} Result of the rewrite.
 */
export async function handleRewriteAction(clientId, blockContent) {
	const { getBlock } = select("core/block-editor");
	const block = getBlock(clientId);

	if (!block) {
		throw new Error(`Block with clientId ${clientId} not found`);
	}

	if (isTemplatePart(block)) {
		return applyTemplatePartRewrite(clientId, block, blockContent);
	}

	const originalBlock = {
		clientId,
		name: block.name,
		attributes: { ...block.attributes },
		innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
	};

	const updatedBlocks = parse(blockContent);

	if (!updatedBlocks || updatedBlocks.length === 0) {
		throw new Error("Failed to parse block_content into blocks");
	}

	const ancestorTemplatePart = findAncestorTemplatePart(clientId);

	if (ancestorTemplatePart) {
		const path = getBlockPathInTemplatePart(ancestorTemplatePart.clientId, clientId);
		if (!path) {
			throw new Error(`Could not compute path for block ${clientId} in template part`);
		}
		await modifyTemplatePartEntity(ancestorTemplatePart, (blocks) =>
			replaceBlockAtPath(blocks, path, updatedBlocks)
		);

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} content rewritten in template part successfully`,
			originalBlock,
		};
	}

	// Replace the block entirely — more reliable than patching individual
	// attributes, especially for RichText content (paragraphs, headings).
	const newBlocks = updatedBlocks.map((b) => createBlockFromParsed(b));
	const { replaceBlocks } = dispatch("core/block-editor");
	replaceBlocks(clientId, newBlocks);

	return {
		clientId,
		blockName: block.name,
		message: `Block ${block.name} content rewritten successfully`,
		originalBlock,
	};
}

/**
 * Remove a block from the editor.
 *
 * @param {string} clientId The block's client ID to delete.
 * @return {Promise<Object>} Result of the deletion.
 */
export async function handleDeleteAction(clientId) {
	const { getBlock } = select("core/block-editor");
	const block = getBlock(clientId);

	if (!block) {
		throw new Error(`Block with clientId ${clientId} not found`);
	}

	if (isTemplatePart(block)) {
		return handleDeleteTemplatePart(clientId, block);
	}

	const originalBlock = {
		clientId,
		name: block.name,
		attributes: { ...block.attributes },
		innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
	};

	const ancestorTemplatePart = findAncestorTemplatePart(clientId);

	if (ancestorTemplatePart) {
		const path = getBlockPathInTemplatePart(ancestorTemplatePart.clientId, clientId);
		if (!path) {
			throw new Error(`Could not compute path for block ${clientId} in template part`);
		}
		await modifyTemplatePartEntity(ancestorTemplatePart, (blocks) =>
			removeBlockAtPath(blocks, path)
		);

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} deleted from template part successfully`,
			originalBlock,
		};
	}

	const { removeBlock } = dispatch("core/block-editor");
	removeBlock(clientId);

	return {
		clientId,
		blockName: block.name,
		message: `Block ${block.name} deleted successfully`,
		originalBlock,
	};
}

/**
 * Move a block to a new position relative to another block.
 *
 * @param {string} clientId       The block to move.
 * @param {string} targetClientId The target block to position relative to.
 * @param {string} position       "before" or "after" the target block.
 * @return {Promise<Object>} Result of the move, including original position for undo.
 */
export async function handleMoveAction(clientId, targetClientId, position) {
	const { getBlock, getBlockRootClientId, getBlockIndex } = select("core/block-editor");

	const block = getBlock(clientId);
	if (!block) {
		throw new Error(`Block with clientId ${clientId} not found`);
	}

	const targetBlock = getBlock(targetClientId);
	if (!targetBlock) {
		throw new Error(`Target block with clientId ${targetClientId} not found`);
	}

	const originalRootClientId = getBlockRootClientId(clientId) || "";
	const originalIndex = getBlockIndex(clientId);

	const sourceAncestor = findAncestorTemplatePart(clientId);
	const targetAncestor = findAncestorTemplatePart(targetClientId);

	if (sourceAncestor || targetAncestor) {
		// Move within the SAME template part — use entity-based approach
		if (sourceAncestor && targetAncestor && sourceAncestor.clientId === targetAncestor.clientId) {
			const sourcePath = getBlockPathInTemplatePart(sourceAncestor.clientId, clientId);
			const targetPath = getBlockPathInTemplatePart(targetAncestor.clientId, targetClientId);

			if (!sourcePath || !targetPath) {
				throw new Error("Could not compute paths for move within template part");
			}

			await modifyTemplatePartEntity(sourceAncestor, (blocks) => {
				let movedBlock = null;
				const findBlockInTree = (tree, path) => {
					if (path.length === 1) {
						return tree[path[0]];
					}
					return findBlockInTree(tree[path[0]].innerBlocks || [], path.slice(1));
				};
				movedBlock = findBlockInTree(blocks, sourcePath);
				if (!movedBlock) {
					return blocks;
				}

				let modified = removeBlockAtPath(blocks, sourcePath);

				if (position === "after") {
					modified = insertBlocksAtPath(modified, targetPath, [movedBlock]);
				} else {
					const parentPath = targetPath.slice(0, -1);
					const targetIdx = targetPath[targetPath.length - 1];
					const insertAt = [...parentPath, Math.max(0, targetIdx - 1)];
					modified = insertBlocksAtPath(modified, insertAt, [movedBlock]);
				}

				return modified;
			});
		} else {
			// Cross-template-part moves — fall back to standard dispatch
			const { moveBlockToPosition } = dispatch("core/block-editor");
			const targetRootClientId = getBlockRootClientId(targetClientId) || "";
			let targetIndex = getBlockIndex(targetClientId);
			if (position === "after") {
				targetIndex += 1;
			}
			if (originalRootClientId === targetRootClientId && originalIndex < targetIndex) {
				targetIndex -= 1;
			}
			moveBlockToPosition(clientId, originalRootClientId, targetRootClientId, targetIndex);
		}
	} else {
		const { moveBlockToPosition } = dispatch("core/block-editor");
		const targetRootClientId = getBlockRootClientId(targetClientId) || "";
		let targetIndex = getBlockIndex(targetClientId);
		if (position === "after") {
			targetIndex += 1;
		}
		if (originalRootClientId === targetRootClientId && originalIndex < targetIndex) {
			targetIndex -= 1;
		}
		moveBlockToPosition(clientId, originalRootClientId, targetRootClientId, targetIndex);
	}

	return {
		clientId,
		blockName: block.name,
		message: `Block ${block.name} moved ${position} ${targetBlock.name} successfully`,
		originalPosition: {
			rootClientId: originalRootClientId,
			index: originalIndex,
		},
	};
}

/**
 * Add new block(s) to the editor.
 *
 * @param {string|null} clientId The client ID to add after (null for top of page).
 * @param {Array}       changes  Array of { block_content } objects.
 * @return {Promise<Object>} Result of the addition.
 */
export async function handleAddAction(clientId, changes) {
	const { getBlocks, getBlock } = select("core/block-editor");
	const { insertBlocks } = dispatch("core/block-editor");
	const errors = [];

	const parsedBlocksList = [];
	for (const change of changes) {
		if (!change.block_content || typeof change.block_content !== "string") {
			errors.push("Add action change missing block_content string");
			continue;
		}

		try {
			const parsedBlocks = parse(change.block_content);
			if (!parsedBlocks || parsedBlocks.length === 0) {
				errors.push("Failed to parse block_content into blocks");
				continue;
			}

			parsedBlocksList.push(...parsedBlocks);
		} catch (error) {
			errors.push(`Failed to parse block_content: ${error.message}`);
			// eslint-disable-next-line no-console
			console.error("Failed to parse block_content:", error);
		}
	}

	if (parsedBlocksList.length === 0) {
		throw new Error("No valid blocks to insert");
	}

	const ancestorTemplatePart = clientId ? findAncestorTemplatePart(clientId) : null;

	if (ancestorTemplatePart) {
		const path = getBlockPathInTemplatePart(ancestorTemplatePart.clientId, clientId);
		if (!path) {
			throw new Error(`Could not compute path for block ${clientId} in template part`);
		}
		await modifyTemplatePartEntity(ancestorTemplatePart, (blocks) =>
			insertBlocksAtPath(blocks, path, parsedBlocksList)
		);
	} else if (clientId === null) {
		const effectiveRoot = getEffectiveRootBlocks();
		if (effectiveRoot.blocks.length > 0) {
			if (effectiveRoot.parentClientId) {
				insertBlocks(parsedBlocksList, 0, effectiveRoot.parentClientId);
			} else {
				insertBlocks(parsedBlocksList, 0, effectiveRoot.blocks[0].clientId);
			}
		} else {
			const rootBlocks = getBlocks();
			const postContentBlock = rootBlocks.find((b) => b.name === "core/post-content");
			if (postContentBlock) {
				insertBlocks(parsedBlocksList, 0, postContentBlock.clientId);
			} else {
				insertBlocks(parsedBlocksList, 0);
			}
		}
	} else {
		const targetBlock = getBlock(clientId);
		if (!targetBlock) {
			throw new Error(`Target block with clientId ${clientId} not found`);
		}

		const context = findBlockContext(clientId);
		if (!context) {
			throw new Error(`Target block ${clientId} not found in the block tree`);
		}

		const insertIndex = context.index + 1;
		insertBlocks(parsedBlocksList, insertIndex, context.parentClientId || undefined);
	}

	const insertedClientIds = parsedBlocksList.map((b) => b.clientId || null).filter(Boolean);

	return {
		clientId: clientId || "root",
		blocksAdded: parsedBlocksList.length,
		insertedClientIds,
		message: `Added ${parsedBlocksList.length} block(s) successfully`,
		errors: errors.length > 0 ? errors : undefined,
	};
}

// ────────────────────────────────────────────────────────────────
// Undo / Restore
// ────────────────────────────────────────────────────────────────

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
