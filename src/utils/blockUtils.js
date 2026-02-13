/**
 * Shared block utility functions.
 *
 * Small, stateless helpers used by both actionExecutor and templatePartEditor.
 */
import { select } from "@wordpress/data";
import { createBlock } from "@wordpress/blocks";

/**
 * Create a WordPress block from a parsed block object (recursive for inner blocks).
 *
 * @param {Object} parsedBlock The parsed block object from wp.blocks.parse().
 * @return {Object} Block compatible with the WordPress block editor.
 */
export function createBlockFromParsed(parsedBlock) {
	const innerBlocks = parsedBlock.innerBlocks
		? parsedBlock.innerBlocks.map((inner) => createBlockFromParsed(inner))
		: [];

	return createBlock(parsedBlock.name, parsedBlock.attributes || {}, innerBlocks);
}

/**
 * Normalize an HTML string by collapsing whitespace for consistent comparison.
 *
 * @param {string} html The HTML string to normalize.
 * @return {string} Normalized HTML string.
 */
export function normalizeHtml(html) {
	return html.replace(/\s+/g, " ").replace(/>\s+</g, "><").replace(/\\\//g, "/").trim();
}

/**
 * Get effective root blocks — either post-content inner blocks or actual root blocks.
 *
 * In the Site Editor the visible blocks live inside a core/post-content wrapper.
 * This helper returns whichever set of blocks represents the "page body".
 *
 * @return {Object} { blocks: Array, parentClientId: string|null }
 */
export function getEffectiveRootBlocks() {
	const { getBlocks } = select("core/block-editor");
	const rootBlocks = getBlocks();

	const postContentBlock = rootBlocks.find((block) => block.name === "core/post-content");

	if (postContentBlock) {
		const postContentInnerBlocks = getBlocks(postContentBlock.clientId);
		if (postContentInnerBlocks.length > 0) {
			return {
				blocks: postContentInnerBlocks,
				parentClientId: postContentBlock.clientId,
			};
		}
	}

	return {
		blocks: rootBlocks,
		parentClientId: null,
	};
}

/**
 * Find a block's parent and index at any nesting depth.
 *
 * @param {string} clientId The block's client ID.
 * @return {Object|null} { parentClientId, index } or null if not found.
 */
export function findBlockContext(clientId) {
	const { getBlockRootClientId, getBlockIndex, getBlock } = select("core/block-editor");

	const block = getBlock(clientId);
	if (!block) {
		return null;
	}

	const parentClientId = getBlockRootClientId(clientId) || "";
	const index = getBlockIndex(clientId);

	if (index === -1) {
		return null;
	}

	return {
		parentClientId,
		index,
	};
}
