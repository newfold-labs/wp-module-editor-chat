/**
 * WordPress dependencies
 */
import { select, resolveSelect } from "@wordpress/data";
import { serialize } from "@wordpress/blocks";

/**
 * Get the current page content
 *
 * @return {Promise<Object>} The page content with template parts
 */
export const getCurrentPageContent = async () => {
	const postContent = getPostContent();
	const templatePartBlocks = getAllTemplatePartBlocks();
	const templatePartsMap = await buildTemplatePartsMap(templatePartBlocks);

	return { page_content: postContent, ...templatePartsMap };
};

// Helpers
const getPostContent = () => {
	const blockEditor = select("core/block-editor");
	const blocks = blockEditor.getBlocks();

	// Find the post-content block
	const postContentBlock = blocks.find((block) => block.name === "core/post-content");

	if (!postContentBlock) {
		return [];
	}

	// Get inner blocks of the post-content block
	const innerBlocks = blockEditor.getBlocks(postContentBlock.clientId);

	// Map each inner block to the required structure
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

const fetchTemplatePartContent = async (tplBlock, coreResolve) => {
	if (!tplBlock || !tplBlock.attributes) {
		return "";
	}
	const { ref, slug, theme } = tplBlock.attributes;

	if (ref) {
		const rec = await coreResolve.getEntityRecord("postType", "wp_template_part", ref);
		return (rec && rec.content && (rec.content.raw || rec.content.rendered)) || "";
	}

	if (slug && theme) {
		const compositeId = `${theme}//${slug}`;
		const recByComposite = await coreResolve.getEntityRecord(
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
		const recs = await coreResolve.getEntityRecords("postType", "wp_template_part", query);
		if (Array.isArray(recs) && recs.length > 0) {
			const exact = recs.find((r) => r && r.slug === slug && (!theme || r.theme === theme));
			const rec = exact || recs[0];
			return (rec && rec.content && (rec.content.raw || rec.content.rendered)) || "";
		}
	}

	return "";
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

/**
 * Get the current page blocks
 *
 * @return {Object} The page blocks
 */
export const getCurrentPageBlocks = () => {
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
