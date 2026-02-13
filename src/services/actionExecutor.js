/**
 * WordPress dependencies
 */
import { dispatch, select } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { serialize, parse } from "@wordpress/blocks";

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
	applyTemplatePartChanges,
	handleDeleteTemplatePart,
} from "./templatePartEditor";
import {
	createBlockFromParsed,
	normalizeHtml,
	getEffectiveRootBlocks,
	findBlockContext,
} from "../utils/blockUtils";

/**
 * Action Executor
 *
 * Executes block-editing actions received from the AI chat.
 * Template-part-specific logic lives in templatePartEditor.js;
 * shared helpers live in blockUtils.js.
 */
class ActionExecutor {
	/**
	 * Execute an array of actions.
	 *
	 * @param {Array} actions Array of actions to execute.
	 * @return {Promise<Object>} Result of action execution.
	 */
	async executeActions(actions) {
		if (!actions || !Array.isArray(actions)) {
			return { success: true, message: "No actions to execute" };
		}

		const results = [];
		const errors = [];

		for (const action of actions) {
			try {
				if (!action.action) {
					errors.push("Action missing 'action' property");
					continue;
				}

				const result = await this.executeAction(action);
				results.push(result);
			} catch (error) {
				errors.push(error.message);
				// eslint-disable-next-line no-console
				console.error("Action failed:", error);
			}
		}

		return {
			success: errors.length === 0,
			message: errors.length === 0 ? "All actions executed successfully" : "Some actions failed",
			results,
			errors,
		};
	}

	/**
	 * Execute a single action.
	 *
	 * @param {Object} action The action to execute.
	 * @return {Promise<Object>} Result of action execution.
	 */
	async executeAction(action) {
		if (action.action === "edit_content") {
			return this.handleEditContentAction(action);
		}

		if (action.action === "change_site_colors") {
			return this.handleChangeSiteColorsAction(action);
		}

		throw new Error(`Unsupported action type: ${action.action}`);
	}

	/**
	 * Handle edit_content action.
	 *
	 * @param {Object} action The action data.
	 * @return {Promise<Object>} Result of the action.
	 */
	async handleEditContentAction(action) {
		const { data } = action;

		if (!data) {
			throw new Error("Edit content action requires data object");
		}

		const operationType = data.operation_type;
		if (!operationType) {
			throw new Error("Edit content action requires data.operation_type");
		}

		const results = [];
		const errors = [];

		try {
			let result;
			if (operationType === "edit") {
				const clientId = data.section;
				if (!clientId) {
					throw new Error("Edit action requires section");
				}

				const blockContent = data.block_content;
				if (!blockContent) {
					throw new Error("Edit action requires block_content");
				}

				result = await this.handleRewriteAction(clientId, blockContent);
				results.push(result);
			} else if (operationType === "delete") {
				const clientId = data.section;
				if (!clientId) {
					throw new Error("Delete action requires section");
				}
				result = await this.handleDeleteAction(clientId);
				results.push(result);
			} else if (operationType === "add") {
				const clientId = data.location;
				const blockContent = data.block_content;
				if (!blockContent) {
					throw new Error("Add action requires block_content");
				}
				result = await this.handleAddAction(clientId || null, [{ block_content: blockContent }]);
				results.push(result);
			} else {
				throw new Error(`Unsupported operation_type: ${operationType}`);
			}
		} catch (error) {
			errors.push(`Failed to execute ${operationType} action: ${error.message}`);
			// eslint-disable-next-line no-console
			console.error(`Failed to execute ${operationType} action:`, error);
		}

		return {
			type: "edit_content",
			success: errors.length === 0,
			message:
				errors.length === 0
					? "All content changes applied successfully"
					: "Some content changes failed",
			results,
			errors,
		};
	}

	// ────────────────────────────────────────────────────────────────
	// Block CRUD operations
	// ────────────────────────────────────────────────────────────────

	/**
	 * Handle "patch" action — apply find/replace changes to a block's content.
	 *
	 * @param {string} clientId The block's client ID.
	 * @param {Array}  changes  Array of { find, replace } objects.
	 * @return {Promise<Object>} Result of the changes.
	 */
	async handlePatchAction(clientId, changes) {
		return this.applyContentChanges(clientId, changes);
	}

	/**
	 * Handle "rewrite" action — replace entire block content.
	 *
	 * @param {string} clientId     The block's client ID.
	 * @param {string} blockContent The new block content HTML.
	 * @return {Promise<Object>} Result of the rewrite.
	 */
	async handleRewriteAction(clientId, blockContent) {
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

		const updatedBlock = updatedBlocks[0];

		if (!updatedBlock) {
			throw new Error("Failed to parse updated block");
		}

		const { updateBlockAttributes, replaceInnerBlocks } = dispatch("core/block-editor");

		if (updatedBlock.attributes) {
			const attrsToApply = { ...updatedBlock.attributes };
			for (const key of Object.keys(block.attributes)) {
				if (!(key in attrsToApply)) {
					attrsToApply[key] = undefined;
				}
			}
			updateBlockAttributes(clientId, attrsToApply);
		}

		if (updatedBlock.innerBlocks && updatedBlock.innerBlocks.length > 0) {
			const innerBlocks = updatedBlock.innerBlocks.map((innerBlock) => {
				return createBlockFromParsed(innerBlock);
			});
			replaceInnerBlocks(clientId, innerBlocks);
		} else if (block.innerBlocks && block.innerBlocks.length > 0) {
			replaceInnerBlocks(clientId, []);
		}

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} content rewritten successfully`,
			originalBlock,
		};
	}

	/**
	 * Apply find/replace changes to a block's content.
	 *
	 * @param {string} clientId The block's client ID.
	 * @param {Array}  changes  Array of { find, replace } objects.
	 * @return {Promise<Object>} Result of the changes.
	 */
	async applyContentChanges(clientId, changes) {
		const { getBlock } = select("core/block-editor");
		const block = getBlock(clientId);

		if (!block) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		if (isTemplatePart(block)) {
			return applyTemplatePartChanges(clientId, block, changes);
		}

		const originalBlock = {
			clientId,
			name: block.name,
			attributes: { ...block.attributes },
			innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
		};

		let blockHtml = serialize(block);

		for (const change of changes) {
			const { find, replace } = change;

			if (typeof find !== "string" || typeof replace !== "string") {
				throw new Error("Change must have find and replace as strings");
			}

			const normalizedBlockHtml = normalizeHtml(blockHtml);
			const normalizedFind = normalizeHtml(find);
			const normalizedReplace = normalizeHtml(replace);

			if (normalizedBlockHtml.includes(normalizedFind)) {
				blockHtml = normalizedBlockHtml.replace(normalizedFind, normalizedReplace);
			} else {
				// eslint-disable-next-line no-console
				console.warn(`Find string not found in block ${clientId}:`, find.substring(0, 50));
			}
		}

		const updatedBlocks = parse(blockHtml);

		if (!updatedBlocks || updatedBlocks.length === 0) {
			throw new Error("Failed to parse updated content into blocks");
		}

		const updatedBlock = updatedBlocks[0];

		if (!updatedBlock) {
			throw new Error("Failed to parse updated block");
		}

		const { updateBlockAttributes, replaceInnerBlocks } = dispatch("core/block-editor");

		if (updatedBlock.attributes) {
			updateBlockAttributes(clientId, updatedBlock.attributes);
		}

		if (updatedBlock.innerBlocks && updatedBlock.innerBlocks.length > 0) {
			const innerBlocks = updatedBlock.innerBlocks.map((innerBlock) => {
				return createBlockFromParsed(innerBlock);
			});
			replaceInnerBlocks(clientId, innerBlocks);
		} else if (block.innerBlocks && block.innerBlocks.length > 0) {
			replaceInnerBlocks(clientId, []);
		}

		return {
			clientId,
			blockName: block.name,
			changesApplied: changes.length,
			message: `Block ${block.name} content updated successfully`,
			originalBlock,
		};
	}

	/**
	 * Handle "delete" action — remove a block from the editor.
	 *
	 * @param {string} clientId The block's client ID to delete.
	 * @return {Promise<Object>} Result of the deletion.
	 */
	async handleDeleteAction(clientId) {
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
	 * Handle "move" action — move a block to a new position relative to another block.
	 *
	 * @param {string} clientId       The block to move.
	 * @param {string} targetClientId The target block to position relative to.
	 * @param {string} position       "before" or "after" the target block.
	 * @return {Promise<Object>} Result of the move, including original position for undo.
	 */
	async handleMoveAction(clientId, targetClientId, position) {
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
					const findBlock = (tree, path) => {
						if (path.length === 1) {
							return tree[path[0]];
						}
						return findBlock(tree[path[0]].innerBlocks || [], path.slice(1));
					};
					movedBlock = findBlock(blocks, sourcePath);
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
	 * Handle "add" action — add new block(s) to the editor.
	 *
	 * @param {string|null} clientId The client ID to add after (null for top of page).
	 * @param {Array}       changes  Array of { block_content } objects.
	 * @return {Promise<Object>} Result of the addition.
	 */
	async handleAddAction(clientId, changes) {
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
				const postContentBlock = rootBlocks.find((block) => block.name === "core/post-content");
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

		const insertedClientIds = parsedBlocksList
			.map((block) => block.clientId || null)
			.filter(Boolean);

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
	async restoreBlocks(undoData) {
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

							const restoredInnerBlocks = originalBlocks.map((inner) =>
								createBlockFromParsed(inner)
							);
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

	// ────────────────────────────────────────────────────────────────
	// Global Styles
	// ────────────────────────────────────────────────────────────────

	/**
	 * Handle change_site_colors action.
	 *
	 * @param {Object} action The action data.
	 * @return {Promise<Object>} Result of the action.
	 */
	async handleChangeSiteColorsAction(action) {
		const { data } = action;

		if (!data || !data.colors || !Array.isArray(data.colors)) {
			throw new Error("Change site colors action requires data.colors array");
		}

		const { __experimentalGetCurrentGlobalStylesId, getEditedEntityRecord } = select(coreStore);
		const globalStylesId = __experimentalGetCurrentGlobalStylesId
			? __experimentalGetCurrentGlobalStylesId()
			: undefined;

		if (!globalStylesId) {
			throw new Error(
				"Global styles not found. Please ensure you have permission to edit global styles."
			);
		}

		const record = getEditedEntityRecord("root", "globalStyles", globalStylesId);

		if (!record || !record.settings) {
			throw new Error("Unable to access global styles settings.");
		}

		const settings = record.settings;
		const rawPalette = settings?.color?.palette?.theme;
		const themePalette = rawPalette || [];

		const originalStyles = JSON.parse(JSON.stringify(settings));

		let updatedPalette = themePalette;
		for (const colorUpdate of data.colors) {
			const { slug, color: newColor } = colorUpdate;

			if (!slug || !newColor) {
				// eslint-disable-next-line no-console
				console.warn("Invalid color update:", colorUpdate);
				continue;
			}

			updatedPalette = updatedPalette.map((color) =>
				color.slug === slug ? { ...color, color: newColor } : color
			);
		}

		const { editEntityRecord } = dispatch(coreStore);

		editEntityRecord("root", "globalStyles", globalStylesId, {
			settings: {
				...(settings || {}),
				color: {
					palette: {
						...(settings?.color?.palette || {}),
						theme: updatedPalette,
					},
				},
			},
		});

		return {
			type: "change_site_colors",
			success: true,
			message: "Site colors updated successfully",
			colorsUpdated: data.colors.length,
			originalStyles,
			globalStylesId,
		};
	}

	/**
	 * Restore global styles to their previous state.
	 *
	 * @param {Object} undoData Object containing originalStyles and globalStylesId.
	 * @return {Promise<Object>} Result of the restore operation.
	 */
	async restoreGlobalStyles(undoData) {
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
}

// Create and export a singleton instance
const actionExecutor = new ActionExecutor();
export default actionExecutor;
