/**
 * Template Part Editor utilities.
 *
 * All logic for editing blocks inside WordPress template parts (headers,
 * footers, sidebars). Template parts use "controlled inner blocks" driven
 * by an entity record — direct block-editor dispatch calls get overwritten.
 * These helpers work with the entity content instead.
 */
import { dispatch, select, resolveSelect } from "@wordpress/data";
import { serialize, parse } from "@wordpress/blocks";

import { createBlockFromParsed, normalizeHtml } from "../utils/blockUtils";

// ────────────────────────────────────────────────────────────────────
// Template part identity & entity helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Check if a block is a template part.
 *
 * @param {Object} block The block to check.
 * @return {boolean} True if the block is a template part.
 */
export const isTemplatePart = (block) => {
	return block && block.name === "core/template-part";
};

/**
 * Get the template part entity record.
 *
 * @param {Object} tplBlock The template part block.
 * @return {Promise<Object|null>} The entity record.
 */
export const getTemplatePartEntity = async (tplBlock) => {
	if (!tplBlock || !tplBlock.attributes) {
		return null;
	}

	const { ref, slug, theme } = tplBlock.attributes;
	const coreResolve = resolveSelect("core");

	if (ref) {
		return await coreResolve.getEntityRecord("postType", "wp_template_part", ref);
	}

	if (slug && theme) {
		const compositeId = `${theme}//${slug}`;
		const rec = await coreResolve.getEntityRecord("postType", "wp_template_part", compositeId);
		if (rec) {
			return rec;
		}
	}

	if (slug) {
		const query = theme ? { slug: [slug], theme } : { slug: [slug] };
		const recs = await coreResolve.getEntityRecords("postType", "wp_template_part", query);
		if (Array.isArray(recs) && recs.length > 0) {
			const exact = recs.find((r) => r && r.slug === slug && (!theme || r.theme === theme));
			return exact || recs[0];
		}
	}

	return null;
};

/**
 * Get template part entity record ID.
 *
 * @param {Object} tplBlock The template part block.
 * @return {Promise<string|number|null>} The entity record ID.
 */
export const getTemplatePartEntityId = async (tplBlock) => {
	if (tplBlock?.attributes?.ref) {
		return tplBlock.attributes.ref;
	}

	const entity = await getTemplatePartEntity(tplBlock);
	return entity?.id || null;
};

/**
 * Fetch template part content from entity.
 *
 * @param {Object} tplBlock    The template part block.
 * @param {Object} coreResolve Optional core resolve selector.
 * @return {Promise<string>}   The template part content as HTML string.
 */
export const fetchTemplatePartContent = async (tplBlock, coreResolve = null) => {
	if (!tplBlock || !tplBlock.attributes) {
		return "";
	}
	const { ref, slug, theme } = tplBlock.attributes;
	const resolve = coreResolve || resolveSelect("core");

	if (ref) {
		const rec = await resolve.getEntityRecord("postType", "wp_template_part", ref);
		return (rec && rec.content && (rec.content.raw || rec.content.rendered)) || "";
	}

	if (slug && theme) {
		const compositeId = `${theme}//${slug}`;
		const recByComposite = await resolve.getEntityRecord(
			"postType",
			"wp_template_part",
			compositeId
		);
		if (recByComposite && recByComposite.content) {
			return recByComposite.content.raw || recByComposite.content.rendered || "";
		}
	}

	if (slug) {
		const query = theme ? { slug: [slug], theme } : { slug: [slug] };
		const recs = await resolve.getEntityRecords("postType", "wp_template_part", query);
		if (Array.isArray(recs) && recs.length > 0) {
			const exact = recs.find((r) => r && r.slug === slug && (!theme || r.theme === theme));
			const rec = exact || recs[0];
			return (rec && rec.content && (rec.content.raw || rec.content.rendered)) || "";
		}
	}

	return "";
};

/**
 * Update template part content — edit the entity record and save to DB.
 *
 * @param {Object} tplBlock           The template part block.
 * @param {Array}  updatedInnerBlocks The updated inner blocks.
 * @return {Promise<Object>}          Result of the update.
 */
export const updateTemplatePartContent = async (tplBlock, updatedInnerBlocks) => {
	try {
		const entityId = await getTemplatePartEntityId(tplBlock);

		if (!entityId) {
			throw new Error("Could not resolve template part entity ID");
		}

		const updatedContent = updatedInnerBlocks.map((block) => serialize(block)).join("");
		const coreDispatch = dispatch("core");

		await coreDispatch.editEntityRecord("postType", "wp_template_part", entityId, {
			content: updatedContent,
		});

		const savedRecord = await coreDispatch.saveEditedEntityRecord(
			"postType",
			"wp_template_part",
			entityId
		);

		return {
			success: true,
			message: "Template part updated successfully",
			entityId,
			savedRecord,
		};
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error updating template part:", error);
		return {
			success: false,
			message: `Failed to update template part: ${error.message}`,
			error,
		};
	}
};

// ────────────────────────────────────────────────────────────────────
// Tree traversal helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Walk up the block tree and return the closest ancestor template-part block,
 * or null if the block is not inside a template part.
 *
 * @param {string} clientId The block's client ID.
 * @return {Object|null} The ancestor template-part block, or null.
 */
export function findAncestorTemplatePart(clientId) {
	const { getBlockRootClientId, getBlock } = select("core/block-editor");
	let currentId = getBlockRootClientId(clientId);
	while (currentId) {
		const block = getBlock(currentId);
		if (block && isTemplatePart(block)) {
			return block;
		}
		currentId = getBlockRootClientId(currentId);
	}
	return null;
}

/**
 * Compute the relative index path from a template part to a nested block.
 *
 * @param {string} templatePartClientId The template part's clientId.
 * @param {string} targetClientId       The target block's clientId.
 * @return {Array<number>|null} Index path, or null if not inside the template part.
 */
export function getBlockPathInTemplatePart(templatePartClientId, targetClientId) {
	const { getBlockRootClientId, getBlockIndex } = select("core/block-editor");
	const path = [];
	let currentId = targetClientId;

	while (currentId && currentId !== templatePartClientId) {
		path.unshift(getBlockIndex(currentId));
		currentId = getBlockRootClientId(currentId);
	}

	return currentId === templatePartClientId ? path : null;
}

// ────────────────────────────────────────────────────────────────────
// Block-tree manipulation (immutable)
// ────────────────────────────────────────────────────────────────────

/**
 * Remove a block at the given index path from a parsed block tree.
 *
 * @param {Array}         blocks Parsed block tree.
 * @param {Array<number>} path   Index path to the block to remove.
 * @return {Array} New block tree with the block removed.
 */
export function removeBlockAtPath(blocks, path) {
	if (!path || path.length === 0) {
		return blocks;
	}

	const [index, ...rest] = path;

	if (rest.length === 0) {
		return blocks.filter((_, i) => i !== index);
	}

	return blocks.map((block, i) => {
		if (i !== index) {
			return block;
		}
		return {
			...block,
			innerBlocks: removeBlockAtPath(block.innerBlocks || [], rest),
		};
	});
}

/**
 * Replace a block at the given index path with new blocks.
 *
 * @param {Array}         blocks    Parsed block tree.
 * @param {Array<number>} path      Index path to the block to replace.
 * @param {Array}         newBlocks Replacement blocks.
 * @return {Array} New block tree with the block replaced.
 */
export function replaceBlockAtPath(blocks, path, newBlocks) {
	if (!path || path.length === 0) {
		return blocks;
	}

	const [index, ...rest] = path;

	if (rest.length === 0) {
		return [...blocks.slice(0, index), ...newBlocks, ...blocks.slice(index + 1)];
	}

	return blocks.map((block, i) => {
		if (i !== index) {
			return block;
		}
		return {
			...block,
			innerBlocks: replaceBlockAtPath(block.innerBlocks || [], rest, newBlocks),
		};
	});
}

/**
 * Insert blocks after a given index path in a parsed block tree.
 *
 * @param {Array}         blocks    Parsed block tree.
 * @param {Array<number>} path      Index path of the block to insert after.
 * @param {Array}         newBlocks Blocks to insert.
 * @return {Array} New block tree with blocks inserted.
 */
export function insertBlocksAtPath(blocks, path, newBlocks) {
	if (!path || path.length === 0) {
		return blocks;
	}

	const [index, ...rest] = path;

	if (rest.length === 0) {
		return [...blocks.slice(0, index + 1), ...newBlocks, ...blocks.slice(index + 1)];
	}

	return blocks.map((block, i) => {
		if (i !== index) {
			return block;
		}
		return {
			...block,
			innerBlocks: insertBlocksAtPath(block.innerBlocks || [], rest, newBlocks),
		};
	});
}

// ────────────────────────────────────────────────────────────────────
// Entity-level operations
// ────────────────────────────────────────────────────────────────────

/**
 * Modify a template part's entity content, update the editor, and save to DB.
 *
 * @param {Object}   templatePartBlock The template part block.
 * @param {Function} modifyFn          Takes parsed blocks, returns modified blocks.
 * @return {Promise<Object>} Save result.
 */
export async function modifyTemplatePartEntity(templatePartBlock, modifyFn) {
	const entityContent = await fetchTemplatePartContent(templatePartBlock);

	if (!entityContent) {
		throw new Error("Template part has no content");
	}

	const parsedBlocks = parse(entityContent);
	const modifiedBlocks = modifyFn(parsedBlocks);

	const updatedInnerBlocks = modifiedBlocks.map((b) => createBlockFromParsed(b));
	const { replaceInnerBlocks } = dispatch("core/block-editor");
	replaceInnerBlocks(templatePartBlock.clientId, updatedInnerBlocks);

	const result = await updateTemplatePartContent(templatePartBlock, updatedInnerBlocks);
	return result;
}

// ────────────────────────────────────────────────────────────────────
// Template-part-specific CRUD operations
// ────────────────────────────────────────────────────────────────────

/**
 * Rewrite a template part's full content.
 *
 * @param {string} clientId     The template part's client ID.
 * @param {Object} block        The template part block.
 * @param {string} blockContent The new block content HTML.
 * @return {Promise<Object>} Result of the rewrite.
 */
export async function applyTemplatePartRewrite(clientId, block, blockContent) {
	const originalEntity = await getTemplatePartEntity(block);

	const originalBlock = {
		clientId,
		name: block.name,
		attributes: { ...block.attributes },
		innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
		isTemplatePart: true,
		entityContent: originalEntity ? originalEntity.content : null,
	};

	// Strip template-part wrapper if the AI included it.
	let innerContent = blockContent;
	const tpMatch = blockContent.match(
		/^<!--\s*wp:template-part\s+\{[\s\S]*?\}\s*-->([\s\S]*)<!--\s*\/wp:template-part\s*-->\s*$/
	);
	if (tpMatch) {
		const rawInner = tpMatch[1].trim();
		const tagMatch = rawInner.match(/^<[a-z][^>]*>([\s\S]*)<\/[a-z]+>$/i);
		innerContent = tagMatch ? tagMatch[1].trim() : rawInner;
	}

	const updatedBlocks = parse(innerContent);

	if (!updatedBlocks || updatedBlocks.length === 0) {
		throw new Error("Failed to parse block_content into blocks");
	}

	const { replaceInnerBlocks } = dispatch("core/block-editor");
	const updatedInnerBlocks = updatedBlocks.map((parsedBlock) => createBlockFromParsed(parsedBlock));
	replaceInnerBlocks(clientId, updatedInnerBlocks);

	const entityUpdateResult = await updateTemplatePartContent(block, updatedInnerBlocks);

	if (!entityUpdateResult.success) {
		// eslint-disable-next-line no-console
		console.warn("Template part entity update failed:", entityUpdateResult.message);
	}

	return {
		clientId,
		blockName: block.name,
		message: `Template part content rewritten successfully`,
		originalBlock,
		isTemplatePart: true,
		entityUpdateResult,
	};
}

/**
 * Apply find/replace changes to a template part's content.
 *
 * @param {string} clientId The template part's client ID.
 * @param {Object} block    The template part block.
 * @param {Array}  changes  Array of { find, replace } objects.
 * @return {Promise<Object>} Result of the changes.
 */
export async function applyTemplatePartChanges(clientId, block, changes) {
	const coreResolve = resolveSelect("core");

	const originalEntity = await getTemplatePartEntity(block);

	const originalBlock = {
		clientId,
		name: block.name,
		attributes: { ...block.attributes },
		innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
		isTemplatePart: true,
		entityContent: originalEntity ? originalEntity.content : null,
	};

	const templatePartContent = await fetchTemplatePartContent(block, coreResolve);
	if (!templatePartContent) {
		throw new Error("Template part has no content to modify");
	}

	let updatedContent = templatePartContent;
	let changesApplied = 0;

	for (const change of changes) {
		const { find, replace } = change;

		if (typeof find !== "string" || typeof replace !== "string") {
			throw new Error("Change must have find and replace as strings");
		}

		const normalizedContent = normalizeHtml(updatedContent);
		const normalizedFind = normalizeHtml(find);
		const normalizedReplace = normalizeHtml(replace);

		if (normalizedContent.includes(normalizedFind)) {
			updatedContent = normalizedContent.replace(normalizedFind, normalizedReplace);
			changesApplied++;
		}
	}

	if (changesApplied === 0) {
		return {
			clientId,
			blockName: block.name,
			changesApplied: 0,
			message: `No matching content found in template part`,
			originalBlock,
			isTemplatePart: true,
		};
	}

	const updatedBlocks = parse(updatedContent);

	if (!updatedBlocks || updatedBlocks.length === 0) {
		throw new Error("Failed to parse updated template part content into blocks");
	}

	const { replaceInnerBlocks } = dispatch("core/block-editor");
	const updatedInnerBlocks = updatedBlocks.map((parsedBlock) => createBlockFromParsed(parsedBlock));
	replaceInnerBlocks(clientId, updatedInnerBlocks);

	const entityUpdateResult = await updateTemplatePartContent(block, updatedInnerBlocks);

	if (!entityUpdateResult.success) {
		// eslint-disable-next-line no-console
		console.warn("Template part entity update failed:", entityUpdateResult.message);
	}

	return {
		clientId,
		blockName: block.name,
		changesApplied,
		message: `Template part content updated successfully`,
		originalBlock,
		isTemplatePart: true,
		entityUpdateResult,
	};
}

/**
 * Delete a template part block.
 *
 * @param {string} clientId The template part's client ID.
 * @param {Object} block    The template part block.
 * @return {Promise<Object>} Result of the deletion.
 */
export async function handleDeleteTemplatePart(clientId, block) {
	const originalEntity = await getTemplatePartEntity(block);

	const originalBlock = {
		clientId,
		name: block.name,
		attributes: { ...block.attributes },
		innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
		isTemplatePart: true,
		entityContent: originalEntity ? originalEntity.content : null,
	};

	const { removeBlock } = dispatch("core/block-editor");
	removeBlock(clientId);

	return {
		clientId,
		blockName: block.name,
		message: `Template part deleted successfully`,
		originalBlock,
		isTemplatePart: true,
	};
}
