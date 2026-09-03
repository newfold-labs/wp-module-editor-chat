/**
 * Template-entity edits.
 *
 * Blocks sitting directly in the template (core/post-title, the post-content
 * wrapper) are edit-disabled while a page is open, so core refuses to touch
 * them. Template PARTS already have an entity path in templatePartEditor; this
 * is the same move for the template itself.
 *
 * Only reached when the user explicitly asked for a template-wide change, since
 * the template is shared by every page using it.
 */
import { parse, serialize } from "@wordpress/blocks";
import { dispatch, select } from "@wordpress/data";

import { createBlockFromParsed } from "../utils/blockUtils";
import { removeBlockAtPath } from "./templatePartEditor";

/** Words that mean the user wants the change to apply beyond this page. */
const TEMPLATE_SCOPE_PATTERN = /\btemplates?\b|\bevery page\b|\ball pages\b|\bsite[- ]wide\b/i;

/**
 * Whether the user asked for a template-wide change.
 *
 * @param {string} message The user's instruction for this turn.
 * @return {boolean} True when the wording is explicit about template scope.
 */
export function wantsTemplateScope(message) {
	return TEMPLATE_SCOPE_PATTERN.test(message || "");
}

/**
 * The template currently being rendered around the page.
 *
 * @return {number|string|null} Template entity id, or null if unavailable.
 */
export function getCurrentTemplateId() {
	return select("core/editor")?.getCurrentTemplateId?.() ?? null;
}

/**
 * Index path from the template root down to a block.
 *
 * The entity stores markup, so parse() hands back fresh clientIds and the
 * target cannot be matched by id. The editor tree mirrors the entity, so the
 * path of indices addresses the same block in both.
 *
 * @param {string} targetClientId Block to locate.
 * @return {number[]|null} Path of child indices, or null if not at template level.
 */
export function getBlockPathInTemplate(targetClientId) {
	const { getBlockRootClientId, getBlockIndex } = select("core/block-editor");
	const path = [];
	let currentId = targetClientId;

	while (currentId) {
		path.unshift(getBlockIndex(currentId));
		currentId = getBlockRootClientId(currentId);
	}

	return path.length > 0 ? path : null;
}

/**
 * Remove a block from the page's template entity.
 *
 * @param {string} clientId  Block to remove.
 * @param {string} blockName Block name, for the result message.
 * @return {Promise<Object>} Result of the removal.
 */
export async function removeBlockFromTemplate(clientId, blockName) {
	const templateId = getCurrentTemplateId();
	if (!templateId) {
		throw new Error("Could not resolve the template for this page.");
	}

	const record = select("core").getEditedEntityRecord("postType", "wp_template", templateId);
	const rawContent = record?.content?.raw ?? record?.content ?? "";
	if (typeof rawContent !== "string" || !rawContent) {
		throw new Error("Template has no editable content.");
	}

	const path = getBlockPathInTemplate(clientId);
	if (!path) {
		throw new Error("Could not locate that block in the template.");
	}

	const parsedBlocks = parse(rawContent);
	const modifiedBlocks = removeBlockAtPath(parsedBlocks, path);

	const before = parsedBlocks.length;
	const after = modifiedBlocks.length;
	const nestedChange = JSON.stringify(modifiedBlocks) !== JSON.stringify(parsedBlocks);
	if (before === after && !nestedChange) {
		throw new Error("Template content is unchanged; the block was not found at that position.");
	}

	await dispatch("core").editEntityRecord("postType", "wp_template", templateId, {
		content: serialize(modifiedBlocks.map((b) => createBlockFromParsed(b))),
	});

	return {
		clientId,
		blockName,
		templateId,
		message: `Removed ${blockName} from the page template. This affects every page using it.`,
	};
}
