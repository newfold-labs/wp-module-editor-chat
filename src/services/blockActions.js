/**
 * Block actions — the Gutenberg-mutation layer.
 *
 * Pure block-tree operations (rewrite, delete, move, add, duplicate,
 * insert-inner). Knows nothing about the AI or chat UI; each function
 * takes plain inputs and dispatches to @wordpress/data.
 *
 * Template-part-specific logic lives in templatePartEditor.js;
 * shared helpers live in utils/blockUtils.js.
 */
import { parse, cloneBlock } from "@wordpress/blocks";
import { dispatch, select } from "@wordpress/data";

import {
	createBlockFromParsed,
	findBlockContext,
	getEffectiveRootBlocks,
} from "../utils/blockUtils";
import { resolveTarget } from "./targetResolver";
import {
	applyTemplatePartRewrite,
	findAncestorTemplatePart,
	getBlockPathInTemplatePart,
	handleDeleteTemplatePart,
	insertBlocksAtPath,
	insertBlocksBeforePath,
	isTemplatePart,
	modifyTemplatePartEntity,
	removeBlockAtPath,
	replaceBlockAtPath,
} from "./templatePartEditor";
import {
	deleteNavigationMenuItemsByLabel,
	duplicateEditorBlockInNavigation,
	ensureMenuBlockAccessible,
	ensureNavigationInnerBlocksLoaded,
	findAncestorRefNavigation,
	findHeaderRefNavigationBlock,
	hydrateAllRefNavigationBlocks,
	getBlockPathInNavigation,
	getNavigationMenuLinks,
	insertBlocksInNavigation,
	isRefNavigation,
	modifyNavigationEntity,
	buildParsedNavigationLinkFromAttrs,
	createNavigationEditorBlocks,
	findNavigationPageLinkInMenu,
	getNavigationParsedBlocksForEdit,
	normalizeParsedNavigationLinks,
	parseNavigationLinkAttrsFromMarkup,
	resolvePageNavigationAttrs,
	assertNavigationPageExists,
	resolveNavigationMenuLinkTarget,
	resolveRefNavigationForEdit,
	summarizeNavigationMenuItems,
	summarizeNavigationMenuItemsFromEntity,
	updateNavigationLinkAttributes,
	syncNavigationEntityFromEditor,
} from "./navigationEditor";

// ────────────────────────────────────────────────────────────────
// Block CRUD operations
// ────────────────────────────────────────────────────────────────

/**
 * Load the site header's linked navigation menu for menu-item edits.
 *
 * @return {Promise<Object|null>}
 */
async function hydrateHeaderNavigation() {
	const nav = findHeaderRefNavigationBlock();
	if (!nav) {
		return null;
	}
	await ensureNavigationInnerBlocksLoaded(nav);
	return nav;
}

/**
 * Resolve header navigation when a menu-link clientId belongs to it.
 *
 * @param {string} clientId Block inside a navigation menu.
 * @return {Promise<Object|null>}
 */
async function resolveHeaderNavigationForClient(clientId) {
	const headerNav = await hydrateHeaderNavigation();
	if (!headerNav) {
		return null;
	}
	const path = getBlockPathInNavigation(headerNav.clientId, clientId);
	return path ? headerNav : null;
}

/**
 * Reject a replacement WordPress would silently refuse.
 *
 * core's replaceBlocks() is a thunk that returns without dispatching when any
 * replacement block fails canInsertBlockType at the target's root — no throw,
 * no return value, all-or-nothing. Checking first turns a silent no-op into a
 * tool error naming the offending block type, which the model can act on.
 *
 * @param {string} clientId  The block being replaced.
 * @param {Array}  newBlocks Replacement blocks.
 */
function assertBlocksInsertable(clientId, newBlocks) {
	const { getBlockRootClientId, canInsertBlockType, getBlockName } = select("core/block-editor");
	const rootClientId = getBlockRootClientId(clientId);

	for (const candidate of newBlocks) {
		if (!canInsertBlockType(candidate.name, rootClientId)) {
			const parentName = rootClientId ? getBlockName(rootClientId) : "the document root";
			throw new Error(
				`${candidate.name} cannot be placed inside ${parentName}. Edit this block's ` +
					`children individually with blu-update-block-attrs, or add new content with ` +
					`blu-add-section.`
			);
		}
	}
}

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

	// core/post-content is the page body inside the site editor's template. The
	// block itself sits at the template root, which is edit-disabled while a page
	// is open, so replaceBlocks() would be refused silently. Replacing its inner
	// blocks is the equivalent operation and writes through to the page entity —
	// replaceInnerBlocks is a plain action with no canInsertBlockType guard.
	if (block.name === "core/post-content") {
		const innerBlocks = updatedBlocks.map((b) => createBlockFromParsed(b));
		const { replaceInnerBlocks } = dispatch("core/block-editor");
		replaceInnerBlocks(clientId, innerBlocks, false);

		if (select("core/block-editor").getBlocks(clientId).length !== innerBlocks.length) {
			throw new Error("Page content replacement did not apply — the page is unchanged.");
		}

		return {
			clientId,
			blockName: block.name,
			message: `Page content replaced with ${innerBlocks.length} top-level block(s)`,
			originalBlock,
		};
	}

	const ancestorNav =
		(await resolveRefNavigationForEdit(clientId)) || (await resolveHeaderNavigationForClient(clientId));

	if (ancestorNav) {
		const path = getBlockPathInNavigation(ancestorNav.clientId, clientId);
		if (!path) {
			throw new Error(`Could not compute path for block ${clientId} in navigation menu`);
		}
		await modifyNavigationEntity(ancestorNav, (blocks) =>
			replaceBlockAtPath(blocks, path, updatedBlocks)
		);

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} content rewritten in navigation menu successfully`,
			originalBlock,
		};
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

	assertBlocksInsertable(clientId, newBlocks);
	replaceBlocks(clientId, newBlocks);

	// replaceBlocks removes the old clientId on success (createBlockFromParsed
	// mints fresh ones). If it survived, the dispatch was refused — template
	// lock, disabled editing mode, allowedBlocks — and the tree is untouched.
	// Never report that as a rewrite.
	if (getBlock(clientId)) {
		throw new Error(
			`WordPress refused to replace ${block.name} and the page is unchanged. This block ` +
				`cannot be replaced in place — edit its children instead.`
		);
	}

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
 * @param {string|Object} clientIdOrParams Block clientId, or { client_id, label } for menu items.
 * @return {Promise<Object>} Result of the deletion.
 */
export async function handleDeleteAction(clientIdOrParams) {
	const { getBlock } = select("core/block-editor");
	const params =
		typeof clientIdOrParams === "object" && clientIdOrParams !== null
			? clientIdOrParams
			: { client_id: clientIdOrParams };
	const label = params.label;
	let clientId = params.client_id;

	// Navigation menu: label wins over client_id (ids go stale and often point at the wrong link).
	if (label) {
		const byLabel = await deleteNavigationMenuItemsByLabel(label, {
			once: true,
			headerOnly: true,
		});
		if (byLabel.removed > 0) {
			const header = findHeaderRefNavigationBlock();
			const menuItems = header
				? await summarizeNavigationMenuItemsFromEntity(header)
				: byLabel.menu_items;
			return {
				clientId: clientId || null,
				blockName: "core/navigation-link",
				message: `Removed menu item "${label}" from header navigation`,
				menu_items: menuItems,
			};
		}

		const header = findHeaderRefNavigationBlock();
		const menuItems = header
			? await summarizeNavigationMenuItemsFromEntity(header, { includePageTitles: true })
			: [];
		throw new Error(
			`No header menu item matched label "${label}"` +
				(menuItems.length ? `. Current items: ${JSON.stringify(menuItems)}` : "")
		);
	}

	if (clientId) {
		const headerNav = findHeaderRefNavigationBlock();
		if (headerNav) {
			const path = getBlockPathInNavigation(headerNav.clientId, clientId);
			if (path) {
				throw new Error(
					'Navigation menu deletes must use { "label": "Item label" } — client_ids go stale after every menu edit.'
				);
			}
		}
	}

	let block =
		(clientId ? await ensureMenuBlockAccessible(clientId) : null) ||
		(clientId ? getBlock(clientId) : null);

	if (!block && (clientId || label)) {
		const resolved = await resolveNavigationMenuLinkTarget({ client_id: clientId, label });
		if (resolved) {
			clientId = resolved.client_id;
			block = resolved.block;
		}
	}

	if (!block) {
		const navs = await hydrateAllRefNavigationBlocks();
		const menuItems = navs.flatMap((nav) => summarizeNavigationMenuItems(nav));
		throw new Error(
			`Block with clientId ${clientId || "(none)"} not found` +
				(label ? ` and no menu item matched label "${label}"` : "") +
				(menuItems.length ? `. Current menu items: ${JSON.stringify(menuItems)}` : "")
		);
	}

	clientId = block.clientId;

	if (isTemplatePart(block)) {
		return handleDeleteTemplatePart(clientId, block);
	}

	const originalBlock = {
		clientId,
		name: block.name,
		attributes: { ...block.attributes },
		innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
	};

	const ancestorNav =
		(await resolveRefNavigationForEdit(clientId)) || (await resolveHeaderNavigationForClient(clientId));

	if (ancestorNav) {
		const path = getBlockPathInNavigation(ancestorNav.clientId, clientId);
		if (!path) {
			throw new Error(`Could not compute path for block ${clientId} in navigation menu`);
		}
		await modifyNavigationEntity(ancestorNav, (blocks) => removeBlockAtPath(blocks, path));

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} deleted from navigation menu successfully`,
			originalBlock,
			menu_items: summarizeNavigationMenuItems(ancestorNav),
		};
	}

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
 * Move a block to a new position.
 *
 * Supports two modes:
 * 1. Sibling mode (target_client_id + position): place before/after another block.
 * 2. Child mode (asChildOf): move INTO a container block as its last child.
 *
 * @param {string}      clientId       The block to move.
 * @param {string|null} targetClientId Sibling mode: the reference block. Null in child mode.
 * @param {string|null} position       Sibling mode: "before" or "after". Null in child mode.
 * @param {string|null} asChildOf      Child mode: container block clientId to move into.
 * @return {Promise<Object>} Result of the move, including original position for undo.
 */
export async function handleMoveAction(clientId, targetClientId, position, asChildOf = null) {
	const { getBlock, getBlockRootClientId, getBlockIndex } = select("core/block-editor");

	const block = getBlock(clientId);
	if (!block) {
		throw new Error(`Block with clientId ${clientId} not found`);
	}

	const originalRootClientId = getBlockRootClientId(clientId) || "";
	const originalIndex = getBlockIndex(clientId);

	// ── Child mode: move block inside a container ──
	if (asChildOf) {
		const containerBlock = getBlock(asChildOf);
		if (!containerBlock) {
			throw new Error(`Container block with clientId ${asChildOf} not found`);
		}

		// Append as last child of the container
		const childCount = containerBlock.innerBlocks?.length || 0;
		const { moveBlockToPosition } = dispatch("core/block-editor");
		moveBlockToPosition(clientId, originalRootClientId, asChildOf, childCount);

		const ancestorNav =
			(await resolveRefNavigationForEdit(clientId)) ||
			(await resolveRefNavigationForEdit(asChildOf));
		if (ancestorNav) {
			await syncNavigationEntityFromEditor(ancestorNav);
		}

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} moved into ${containerBlock.name} as child`,
			originalPosition: {
				rootClientId: originalRootClientId,
				index: originalIndex,
			},
		};
	}

	// ── Sibling mode: move before/after a target block ──
	const targetBlock = getBlock(targetClientId);
	if (!targetBlock) {
		throw new Error(`Target block with clientId ${targetClientId} not found`);
	}

	const sourceAncestorNav = await resolveRefNavigationForEdit(clientId);
	const targetAncestorNav = await resolveRefNavigationForEdit(targetClientId);

	if (sourceAncestorNav || targetAncestorNav) {
		if (
			sourceAncestorNav &&
			targetAncestorNav &&
			sourceAncestorNav.clientId === targetAncestorNav.clientId
		) {
			const sourcePath = getBlockPathInNavigation(sourceAncestorNav.clientId, clientId);
			const targetPath = getBlockPathInNavigation(targetAncestorNav.clientId, targetClientId);

			if (!sourcePath || !targetPath) {
				throw new Error("Could not compute paths for move within navigation menu");
			}

			await modifyNavigationEntity(sourceAncestorNav, (blocks) => {
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

				const adjustedTarget = [...targetPath];
				const srcParent = sourcePath.slice(0, -1);
				const tgtParent = targetPath.slice(0, -1);
				if (
					srcParent.length === tgtParent.length &&
					srcParent.every((v, i) => v === tgtParent[i]) &&
					sourcePath[sourcePath.length - 1] < targetPath[targetPath.length - 1]
				) {
					adjustedTarget[adjustedTarget.length - 1] -= 1;
				}

				if (position === "after") {
					modified = insertBlocksAtPath(modified, adjustedTarget, [movedBlock]);
				} else {
					modified = insertBlocksBeforePath(modified, adjustedTarget, [movedBlock]);
				}

				return modified;
			});
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
			if (sourceAncestorNav) {
				await syncNavigationEntityFromEditor(sourceAncestorNav);
			}
			if (targetAncestorNav && targetAncestorNav.clientId !== sourceAncestorNav?.clientId) {
				await syncNavigationEntityFromEditor(targetAncestorNav);
			}
		}
	} else {
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

				// After removing the source, adjust target path if source was in the
				// same parent and at a lower index (indices shift down by 1).
				const adjustedTarget = [...targetPath];
				const srcParent = sourcePath.slice(0, -1);
				const tgtParent = targetPath.slice(0, -1);
				if (
					srcParent.length === tgtParent.length &&
					srcParent.every((v, i) => v === tgtParent[i]) &&
					sourcePath[sourcePath.length - 1] < targetPath[targetPath.length - 1]
				) {
					adjustedTarget[adjustedTarget.length - 1] -= 1;
				}

				if (position === "after") {
					modified = insertBlocksAtPath(modified, adjustedTarget, [movedBlock]);
				} else {
					modified = insertBlocksBeforePath(modified, adjustedTarget, [movedBlock]);
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
 * @param {string|null} clientId The target block's client ID (null for top of page).
 * @param {Array}       changes  Array of { block_content } objects.
 * @param {string}      position "after" (default) inserts right after the target;
 *                               "before" inserts right before it. Ignored when clientId is null.
 * @return {Promise<Object>} Result of the addition.
 */
export async function handleAddAction(clientId, changes, position = "after") {
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

	// Convert raw parse() output to proper block editor instances.
	// parse() returns objects that may lack clientId and use different
	// property names (blockName/attrs vs name/attributes).  The template-
	// part path converts inside modifyTemplatePartEntity, but the direct
	// insertBlocks() path needs blocks created via createBlock().
	const blockInstances = parsedBlocksList
		.filter((b) => b.name || b.blockName)
		.map((b) => createBlockFromParsed(b));

	if (blockInstances.length === 0) {
		throw new Error("No valid blocks to insert (all freeform/null)");
	}

	const ancestorNav = clientId ? await resolveRefNavigationForEdit(clientId) : null;

	if (ancestorNav) {
		const path = getBlockPathInNavigation(ancestorNav.clientId, clientId);
		if (!path) {
			throw new Error(`Could not compute path for block ${clientId} in navigation menu`);
		}
		const inserter = position === "before" ? insertBlocksBeforePath : insertBlocksAtPath;
		await modifyNavigationEntity(ancestorNav, (blocks) => inserter(blocks, path, parsedBlocksList));
	} else {
	const ancestorTemplatePart = clientId ? findAncestorTemplatePart(clientId) : null;

	if (ancestorTemplatePart) {
		const path = getBlockPathInTemplatePart(ancestorTemplatePart.clientId, clientId);
		if (!path) {
			throw new Error(`Could not compute path for block ${clientId} in template part`);
		}
		const inserter = position === "before" ? insertBlocksBeforePath : insertBlocksAtPath;
		await modifyTemplatePartEntity(ancestorTemplatePart, (blocks) =>
			inserter(blocks, path, parsedBlocksList)
		);
	} else if (clientId === null) {
		const effectiveRoot = getEffectiveRootBlocks();
		if (effectiveRoot.blocks.length > 0) {
			if (effectiveRoot.parentClientId) {
				insertBlocks(blockInstances, 0, effectiveRoot.parentClientId);
			} else {
				insertBlocks(blockInstances, 0, effectiveRoot.blocks[0].clientId);
			}
		} else {
			const rootBlocks = getBlocks();
			const postContentBlock = rootBlocks.find((b) => b.name === "core/post-content");
			if (postContentBlock) {
				insertBlocks(blockInstances, 0, postContentBlock.clientId);
			} else {
				insertBlocks(blockInstances, 0);
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

		const insertIndex = position === "before" ? context.index : context.index + 1;
		insertBlocks(blockInstances, insertIndex, context.parentClientId || undefined);
	}
	}

	const insertedClientIds = blockInstances.map((b) => b.clientId || null).filter(Boolean);

	return {
		clientId: clientId || "root",
		blocksAdded: parsedBlocksList.length,
		insertedClientIds,
		message: `Added ${parsedBlocksList.length} block(s) successfully`,
		errors: errors.length > 0 ? errors : undefined,
	};
}

/**
 * Duplicate a block as its next sibling with fresh clientIds.
 *
 * Dual-mode:
 *   - Explicit: pass { client_id } to clone that specific block.
 *   - Intent:   pass { kind, scope?, position? } and the target resolver picks
 *               the matching block deterministically. No LLM in the loop for
 *               target resolution.
 *
 * Returns a structured result including the newly-created clientId and a
 * "resolved_from" trace when intent mode was used, so the caller can show the
 * user (and the model) exactly which block was cloned.
 *
 * @param {Object}        params
 * @param {string}        [params.client_id] Explicit target clientId.
 * @param {string}        [params.kind]      Intent: lexicon kind ("column", "card", …).
 * @param {string}        [params.scope]     Intent: clientId bounding the search.
 * @param {string|number} [params.position]  Intent: "last" (default) | "first" | integer.
 * @return {Promise<Object>} Duplication result.
 */
export async function handleDuplicateAction(params = {}) {
	const { client_id: explicitClientId, kind, scope, position } = params;
	const { getBlock } = select("core/block-editor");
	const { insertBlocks } = dispatch("core/block-editor");

	let targetClientId = explicitClientId;
	let resolution = null;
	if (!targetClientId) {
		if (!kind) {
			throw new Error(
				"Duplicate requires either client_id (explicit) or kind (intent mode). Neither was provided."
			);
		}
		if (kind === "menu-item") {
			await hydrateAllRefNavigationBlocks();
		}
		resolution = resolveTarget({ kind, scope, position });
		targetClientId = resolution.client_id;
	}

	const block = getBlock(targetClientId);
	if (!block) {
		throw new Error(`Block with clientId ${targetClientId} not found`);
	}

	const context = findBlockContext(targetClientId);
	if (!context) {
		throw new Error(`Block ${targetClientId} not found in the block tree`);
	}

	const ancestorNav =
		(await resolveRefNavigationForEdit(targetClientId)) ||
		(kind === "menu-item" ? await hydrateHeaderNavigation() : null);

	if (ancestorNav) {
		const { newClientId, menu_items: menuItems } = await duplicateEditorBlockInNavigation(
			ancestorNav,
			targetClientId
		);
		const clone = newClientId ? getBlock(newClientId) : null;
		const newLeaves = clone ? summarizeNewSubtree(clone) : [];

		return {
			clientId: targetClientId,
			newClientId: newClientId || null,
			blockName: block.name,
			newSubtree: newLeaves,
			menu_items: menuItems,
			message: resolution
				? `Duplicated ${resolution.kind_matched} (${block.name}) in navigation menu — ${resolution.why}`
				: `Block ${block.name} duplicated in navigation menu successfully`,
			resolution,
		};
	}

	const clone = cloneBlock(block);
	insertBlocks(clone, context.index + 1, context.parentClientId || undefined);

	// Build a compact leaf summary so the follow-up tool call knows which
	// inner clientIds to target (for content customization, style tweaks, etc.).
	// Without this, the model has no map from "leaf paragraph" → clientId in the
	// new subtree and ends up patching the top-level clone with empty attrs.
	const newLeaves = summarizeNewSubtree(clone);

	return {
		clientId: targetClientId,
		newClientId: clone.clientId,
		blockName: block.name,
		newSubtree: newLeaves,
		message: resolution
			? `Duplicated ${resolution.kind_matched} (${block.name}) — ${resolution.why}`
			: `Block ${block.name} duplicated successfully`,
		resolution,
	};
}

/**
 * Walk a freshly-cloned block and return a compact, LLM-friendly flat list of
 * every block in the subtree (parent → leaves), each tagged with its new
 * clientId and a short preview of text/content. The model reads this from the
 * tool result and can immediately target specific leaves with update-block-attrs.
 *
 * @param {Object} root The cloned root block.
 * @return {Array<{client_id: string, name: string, path: string, text?: string}>} Flat list of blocks in the subtree.
 */
function summarizeNewSubtree(root) {
	const out = [];
	const walk = (block, path) => {
		if (!block || !block.clientId) {
			return;
		}
		const textAttr =
			block.attributes?.content ??
			block.attributes?.label ??
			block.attributes?.text ??
			block.attributes?.url ??
			null;
		const entry = {
			client_id: block.clientId,
			name: block.name,
			path,
		};
		if (typeof textAttr === "string" && textAttr.length > 0) {
			entry.text = textAttr.length > 60 ? textAttr.slice(0, 60) + "…" : textAttr;
		}
		out.push(entry);
		if (Array.isArray(block.innerBlocks)) {
			block.innerBlocks.forEach((child, i) => walk(child, `${path}/${i}`));
		}
	};
	walk(root, "0");
	return out;
}

/**
 * Insert a new block as a child of an existing parent at the given index.
 *
 * @param {string}      parentClientId The parent (container) block's client ID.
 * @param {string}      blockContent   WordPress block markup for the new child.
 * @param {number|null} index          0-based insert position; null/undefined = append.
 * @param {Object|null} intendedAttrsOverride Parsed navigation-link attrs from raw tool markup.
 * @return {Promise<Object>} Result of the insertion.
 */
export async function handleInsertInnerBlockAction(
	parentClientId,
	blockContent,
	index = null,
	intendedAttrsOverride = null
) {
	const { getBlock } = select("core/block-editor");
	const { insertBlocks } = dispatch("core/block-editor");

	const parent = getBlock(parentClientId);
	if (!parent) {
		throw new Error(`Parent block with clientId ${parentClientId} not found`);
	}

	const intendedAttrsRaw =
		intendedAttrsOverride || parseNavigationLinkAttrsFromMarkup(blockContent);
	let intendedAttrs =
		intendedAttrsRaw?.id != null
			? await resolvePageNavigationAttrs(intendedAttrsRaw)
			: intendedAttrsRaw;

	if (intendedAttrs?.id != null) {
		await assertNavigationPageExists(intendedAttrs);
	}

	let parsed = null;
	if (intendedAttrs?.id != null) {
		parsed = buildParsedNavigationLinkFromAttrs(intendedAttrs);
		if (!parsed?.length) {
			throw new Error(
				`Failed to build navigation link for page id ${intendedAttrs.id}`
			);
		}
	} else {
		parsed = normalizeParsedNavigationLinks(parse(blockContent));
	}
	if (!parsed || parsed.length === 0) {
		throw new Error("Failed to parse block_content into blocks");
	}

	let parentNav = isRefNavigation(parent) ? parent : findAncestorRefNavigation(parentClientId);
	if (isRefNavigation(parent)) {
		parentNav = getBlock(parentClientId) || parent;
	} else if (parentNav) {
		await ensureNavigationInnerBlocksLoaded(parentNav);
	}

	if (parentNav) {
		const liveParent = getBlock(parentNav.clientId) || parentNav;
		const entityBlocks = await getNavigationParsedBlocksForEdit(liveParent);
		const linkState = await findNavigationPageLinkInMenu(
			liveParent,
			intendedAttrs.id,
			intendedAttrs.label
		);

		if (linkState.present && linkState.labelMatches) {
			const menuItems = await summarizeNavigationMenuItemsFromEntity(liveParent);
			return {
				parentClientId,
				blockName: parent.name,
				insertedClientIds: [],
				menu_items: menuItems,
				insertedAtIndex: null,
				hasChanges: false,
				alreadyPresent: true,
				message: `"${intendedAttrs.label || "Page"}" is already in the header navigation menu.`,
			};
		}

		if (linkState.present && !linkState.labelMatches && intendedAttrs.label) {
			const wantLabel = intendedAttrs.label;
			await modifyNavigationEntity(liveParent, (blocks) =>
				blocks.map((block) => {
					if ((block.name || block.blockName) !== "core/navigation-link") {
						return block;
					}
					const attrs = block.attributes || block.attrs || {};
					if (Number(attrs.id) !== Number(intendedAttrs.id)) {
						return block;
					}
					const nextAttrs = { ...attrs, label: wantLabel };
					return { ...block, attributes: nextAttrs, attrs: nextAttrs };
				})
			);
			const menuItems = await summarizeNavigationMenuItemsFromEntity(liveParent);
			return {
				parentClientId,
				blockName: parent.name,
				insertedClientIds: [],
				menu_items: menuItems,
				insertedAtIndex: null,
				hasChanges: true,
				message: `Updated header menu label to "${wantLabel}". Use menu_items labels for follow-up deletes — do not use client_ids.`,
			};
		}

		const insertAt =
			typeof index === "number" && index >= 0
				? Math.min(index, entityBlocks.length)
				: entityBlocks.length;

		if (isRefNavigation(liveParent)) {
			const blocksToInsert = parsed;
			await modifyNavigationEntity(liveParent, (blocks) => {
				return [
					...blocks.slice(0, insertAt),
					...blocksToInsert,
					...blocks.slice(insertAt),
				];
			});
		} else {
			const parentPath = getBlockPathInNavigation(parentNav.clientId, parentClientId);
			await insertBlocksInNavigation(parentNav, parentPath, parsed, index);
		}

		const menuItems = await summarizeNavigationMenuItemsFromEntity(liveParent);
		const insertedLabel = intendedAttrs?.label || "";

		return {
			parentClientId,
			blockName: parent.name,
			insertedClientIds: [],
			menu_items: menuItems,
			insertedAtIndex: insertAt,
			hasChanges: true,
			message: `Inserted 1 block(s) into header navigation menu${
				insertedLabel ? ` (${insertedLabel})` : ""
			}. Use menu_items labels for follow-up deletes — do not use client_ids.`,
		};
	}

	const blockInstances = createNavigationEditorBlocks(parsed);
	if (blockInstances.length === 0) {
		throw new Error("No valid blocks to insert");
	}

	const childCount = parent.innerBlocks?.length || 0;
	const insertIndex =
		typeof index === "number" && index >= 0 ? Math.min(index, childCount) : childCount;

	insertBlocks(blockInstances, insertIndex, parentClientId);

	return {
		parentClientId,
		blockName: parent.name,
		insertedClientIds: blockInstances.map((b) => b.clientId),
		insertedAtIndex: insertIndex,
		message: `Inserted ${blockInstances.length} block(s) into ${parent.name}`,
	};
}
