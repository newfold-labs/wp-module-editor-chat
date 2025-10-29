/**
 * WordPress dependencies
 */
import { select } from "@wordpress/data";

/**
 * Get the current page content (all blocks)
 *
 * @return {Object} The page content with both raw grammar and structured blocks
 */
export const getCurrentPageContent = () => {
	const blockEditor = select("core/block-editor");

	const blocks = blockEditor.getBlocks();

	// Process blocks to get inner content for post-content and template-part blocks
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
 * Get the current page ID
 *
 * @return {number} The page ID
 */
export const getCurrentPageId = () => {
	const editor = select("core/editor");
	return editor.getCurrentPostId();
};

/**
 * Get the current page title
 *
 * @return {string} The page title
 */
export const getCurrentPageTitle = () => {
	const editor = select("core/editor");
	return editor.getEditedPostAttribute("title") || "";
};

/**
 * Get the currently selected block
 * This is a shared utility that can be used in both React hooks and service functions
 *
 * @return {Object|null} The selected block object or null if none selected
 */
export const getSelectedBlock = () => {
	const blockEditor = select("core/block-editor");

	return blockEditor.getSelectedBlock();
};
