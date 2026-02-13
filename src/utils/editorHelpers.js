/**
 * Editor state helpers.
 *
 * Read-only utilities for building AI context: block tree, page content,
 * selection state, and block markup. Template-part entity CRUD lives in
 * services/templatePartEditor.js.
 */
import { select, resolveSelect } from "@wordpress/data";
import { serialize } from "@wordpress/blocks";

import { fetchTemplatePartContent } from "../services/templatePartEditor";

/**
 * Build a compact text representation of the block tree for AI context.
 *
 * Produces a human-readable indented tree with index paths, block names,
 * clientIds, and text previews. Template parts include area/slug metadata.
 * Selected blocks are marked with [SELECTED].
 *
 * @param {Array}      blocks                     Top-level blocks from getBlocks()
 * @param {Array|null} selectedClientIds          Array of clientIds of the currently selected blocks
 * @param {Object}     options                    Options object
 * @param {boolean}    options.collapseUnselected Whether to collapse unselected blocks
 * @return {string} Compact block tree text
 */
export const buildCompactBlockTree = (
	blocks,
	selectedClientIds = null,
	{ collapseUnselected = false } = {}
) => {
	const lines = [];
	const selectedSet = new Set(selectedClientIds || []);
	const hasSelection = collapseUnselected && selectedSet.size > 0;

	// Check if any block in a subtree contains a selected block
	const subtreeHasSelected = (blockList) => {
		for (const block of blockList) {
			if (selectedSet.has(block.clientId)) {
				return true;
			}
			if (block.innerBlocks?.length > 0 && subtreeHasSelected(block.innerBlocks)) {
				return true;
			}
		}
		return false;
	};

	const extractTextPreview = (block) => {
		// Try common text attributes first
		const content = block.attributes?.content;
		if (content) {
			const plain = content.replace(/<[^>]*>/g, "").trim();
			if (plain) {
				return plain.length > 30 ? plain.substring(0, 30) + "…" : plain;
			}
		}

		// For blocks with metadata name
		const metaName = block.attributes?.metadata?.name;
		if (metaName) {
			return metaName;
		}

		// For blocks with alt text (images)
		const alt = block.attributes?.alt;
		if (alt) {
			return alt.length > 30 ? alt.substring(0, 30) + "…" : alt;
		}

		return null;
	};

	const walkBlocks = (blockList, prefix = "", depth = 0) => {
		blockList.forEach((block, index) => {
			const indexPath = prefix ? `${prefix}.${index}` : `${index}`;
			const isSelected = selectedSet.has(block.clientId);
			const selectedMarker = isSelected ? " [SELECTED]" : "";

			let line = `${"  ".repeat(depth)}[${indexPath}] ${block.name} (id:${block.clientId})`;

			// Add template part metadata
			if (block.name === "core/template-part") {
				const area = block.attributes?.area || "";
				const slug = block.attributes?.slug || "";
				if (area) {
					line += ` area:${area}`;
				}
				if (slug) {
					line += ` slug:${slug}`;
				}
			}

			// Add text preview
			const preview = extractTextPreview(block);
			if (preview) {
				line += ` → "${preview}"`;
			}

			line += selectedMarker;
			lines.push(line);

			// Recurse into inner blocks
			if (block.innerBlocks && block.innerBlocks.length > 0) {
				if (
					hasSelection &&
					!selectedSet.has(block.clientId) &&
					!subtreeHasSelected(block.innerBlocks)
				) {
					lines.push(`${"  ".repeat(depth + 1)}... (${block.innerBlocks.length} inner blocks)`);
				} else {
					walkBlocks(block.innerBlocks, indexPath, depth + 1);
				}
			}
		});
	};

	walkBlocks(blocks);
	return lines.join("\n");
};

/**
 * Get the full serialized markup of a block by its clientId.
 *
 * @param {string} clientId The block's clientId
 * @return {Object|null} Object with block_content, block_name, client_id, or null if not found
 */
export const getBlockMarkup = (clientId) => {
	const blockEditor = select("core/block-editor");
	const block = blockEditor.getBlock(clientId);

	if (!block) {
		return null;
	}

	// Template parts serialize to a self-closing comment (<!-- wp:template-part /-->).
	// The AI needs the actual inner blocks content to be able to modify it.
	let blockContent;
	if (block.name === "core/template-part") {
		const innerBlocks = blockEditor.getBlocks(clientId);
		blockContent = innerBlocks.map((b) => serialize(b)).join("\n");
	} else {
		blockContent = serialize(block);
	}

	return {
		block_content: blockContent,
		block_name: block.name,
		client_id: clientId,
	};
};

/**
 * Get the current page content (body blocks + template part contents).
 *
 * @return {Promise<Object>} The page content with template parts
 */
export const getCurrentPageContent = async () => {
	const postContent = getPostContent();
	const templatePartBlocks = getAllTemplatePartBlocks();
	const templatePartsMap = await buildTemplatePartsMap(templatePartBlocks);

	return { page_content: postContent, ...templatePartsMap };
};

// ── Private helpers ──────────────────────────────────────────────────

const getPostContent = () => {
	const blockEditor = select("core/block-editor");
	const blocks = blockEditor.getBlocks();

	const postContentBlock = blocks.find((block) => block.name === "core/post-content");

	if (!postContentBlock) {
		return blocks.map((block) => ({
			clientId: block.clientId,
			content: serialize(block),
		}));
	}

	const innerBlocks = blockEditor.getBlocks(postContentBlock.clientId);

	return innerBlocks.map((block) => ({
		clientId: block.clientId,
		content: serialize(block),
	}));
};

const getAllTemplatePartBlocks = () => {
	const blockEditor = select("core/block-editor");
	const blocks = blockEditor.getBlocks();
	return blocks.filter((b) => b.name === "core/template-part");
};

const pickTemplatePartKey = (attrs, index) => {
	return (
		attrs.slug || (attrs.ref ? String(attrs.ref) : null) || attrs.area || `template_part_${index}`
	);
};

const buildTemplatePartsMap = async (templatePartBlocks) => {
	const coreResolve = resolveSelect("core");

	const result = {};
	for (let i = 0; i < templatePartBlocks.length; i++) {
		const block = templatePartBlocks[i];
		const attrs = block.attributes || {};
		const html = await fetchTemplatePartContent(block, coreResolve);

		const key = pickTemplatePartKey(attrs, i);
		if (key && !result[key]) {
			result[key] = {
				clientId: block.clientId,
				content: html,
			};
		}
	}

	return result;
};

// ── Public read-only helpers ─────────────────────────────────────────

/**
 * Get the current page blocks (with inner blocks resolved for post-content / template parts).
 *
 * @return {Array} Processed block list
 */
export const getCurrentPageBlocks = () => {
	const blockEditor = select("core/block-editor");

	const blocks = blockEditor.getBlocks();

	const processedBlocks = blocks.map((block) => {
		if (block.name === "core/post-content" || block.name === "core/template-part") {
			return {
				...block,
				innerBlocks: blockEditor.getBlocks(block.clientId),
			};
		}
		return block;
	});

	return processedBlocks;
};

/**
 * Get the current page ID.
 *
 * @return {number} The page ID
 */
export const getCurrentPageId = () => {
	const editor = select("core/editor");
	return editor.getCurrentPostId();
};

/**
 * Get the current page title.
 *
 * @return {string} The page title
 */
export const getCurrentPageTitle = () => {
	const editor = select("core/editor");
	return editor.getEditedPostAttribute("title") || "";
};

/**
 * Get all currently selected blocks.
 *
 * @return {Array} Array of selected block objects (may be empty)
 */
export const getSelectedBlocks = () => {
	const blockEditor = select("core/block-editor");

	const multiSelected = blockEditor.getMultiSelectedBlocks();
	if (multiSelected && multiSelected.length > 0) {
		return multiSelected;
	}

	const single = blockEditor.getSelectedBlock();
	return single ? [single] : [];
};

/**
 * Get a single selected block (legacy helper).
 *
 * @return {Object|null} The selected block or null
 */
export const getSelectedBlock = () => {
	const blocks = getSelectedBlocks();
	return blocks.length > 0 ? blocks[0] : null;
};
