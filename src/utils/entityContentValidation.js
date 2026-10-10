/**
 * Validate Gutenberg block markup in entity create/update ability parameters
 * before forwarding to MCP (blu-add-page, blu-add-post, etc.).
 */
import { validateBlockMarkup } from "./blockValidator";

/** MCP abilities whose `content` field is Gutenberg block markup. */
export const ENTITY_CONTENT_ABILITIES = new Set([
	"blu-add-page",
	"blu-add-post",
	"blu-add-cpt",
	"blu-update-page",
	"blu-update-post",
	"blu-update-cpt",
]);

const LAYOUT_BLOCKS = new Set(["core/group", "core/cover", "core/columns", "core/media-text"]);
const MEDIA_OR_GRID_BLOCKS = new Set([
	"core/cover",
	"core/columns",
	"core/image",
	"core/media-text",
]);
const PALETTE_ATTRS = ["backgroundColor", "textColor", "overlayColor", "gradient"];

const RICH_LAYOUT_ERROR =
	"Page layout is too thin (heading/paragraph stack). Rebuild as a designed page: at least 2 layout blocks (core/group, core/cover, core/columns, or core/media-text); at least one cover, columns, image, or media-text; and at least one theme palette slug (backgroundColor, textColor, overlayColor, or gradient — e.g. base, contrast, accent-2). Do not invent hex colors. If <user_intent>.layout is text_only, simple markup is allowed.";

const RICH_COVER_ERROR =
	"Page is missing a core/cover hero. Add one top-level cover with align:full. Do not use cover for every section.";

const RICH_MEDIA_TEXT_ERROR =
	"Page is missing a core/media-text section. Add one (no align:full) inside a flow group without backgroundColor and without align:full.";

const RICH_COLUMNS_ERROR =
	"Page is missing a core/columns section. Add one (no align:full on the columns block) for a grid of 2–4 items.";

const RICH_BAND_WIDTH_ERROR =
	"A top-level group with backgroundColor must use align:full and layout.type constrained so the background is full-width and inner content stays at theme content width.";

const RICH_BAND_CHILD_FULL_ERROR =
	"Direct children of a colored full-width group must not use align:full (that stretches copy to the viewport edges). Keep columns, media-text, images, and inner groups at default/content width.";

const RICH_FLOW_WIDTH_ERROR =
	"A top-level group without backgroundColor must not use align:full — it should sit at page/content width. Use align:full only on covers and on groups that have a backgroundColor.";

/**
 * @param {string} toolName Hyphen-form ability name.
 * @return {boolean} Whether the ability accepts Gutenberg block markup in `content`.
 */
export function abilityUsesBlockContent(toolName) {
	return ENTITY_CONTENT_ABILITIES.has(toolName);
}

/**
 * Resolve block markup from ability parameters (models use several aliases).
 *
 * @param {Object} args Ability parameters.
 * @return {string|undefined} Raw markup string if present.
 */
export function resolveContentField(args) {
	return args.content || args.block_content || args.markup || args.html || args.block_markup;
}

/**
 * @param {string} layout Classified page layout.
 * @return {boolean} True when richness checks apply.
 */
export function shouldRequireRichPageLayout(layout) {
	return layout !== "text_only";
}

/**
 * Walk parsed blocks and collect layout / media / palette usage.
 *
 * @param {Array} blocks Parsed Gutenberg blocks.
 * @return {{ layout: number, media: number, palette: number }} Layout, media, and palette counts.
 */
export function collectPageLayoutSignals(blocks) {
	const acc = { layout: 0, media: 0, palette: 0 };
	walkLayoutSignals(blocks, acc);
	return acc;
}

/**
 * @param {Array}  blocks Parsed blocks.
 * @param {Object} acc    Running layout/media/palette counts.
 */
function walkLayoutSignals(blocks, acc) {
	if (!Array.isArray(blocks)) {
		return;
	}
	for (const block of blocks) {
		const name = block?.name || block?.blockName;
		const attrs = block?.attributes || block?.attrs || {};
		if (LAYOUT_BLOCKS.has(name)) {
			acc.layout += 1;
		}
		if (MEDIA_OR_GRID_BLOCKS.has(name)) {
			acc.media += 1;
		}
		for (const key of PALETTE_ATTRS) {
			const value = attrs[key];
			if (typeof value === "string" && value && !value.startsWith("#")) {
				acc.palette += 1;
				break;
			}
		}
		if (block?.innerBlocks?.length) {
			walkLayoutSignals(block.innerBlocks, acc);
		}
	}
}

/**
 * @param {Array} blocks Parsed Gutenberg blocks.
 * @return {boolean} True when the page meets the rich-layout bar.
 */
export function isRichPageLayout(blocks) {
	const { layout, media, palette } = collectPageLayoutSignals(blocks);
	return layout >= 2 && media >= 1 && palette >= 1;
}

/**
 * @param {Object} block Parsed Gutenberg block.
 * @return {string} Block name.
 */
function blockName(block) {
	return block?.name || block?.blockName || "";
}

/**
 * @param {Object} block Parsed Gutenberg block.
 * @return {Object} Block attributes.
 */
function blockAttrs(block) {
	return block?.attributes || block?.attrs || {};
}

/**
 * @param {Array}  blocks Parsed blocks.
 * @param {Object} [acc]  Running type counts.
 * @return {{ cover: number, columns: number, mediaText: number }}
 */
function countLayoutTypes(blocks, acc = { cover: 0, columns: 0, mediaText: 0 }) {
	if (!Array.isArray(blocks)) {
		return acc;
	}
	for (const block of blocks) {
		const name = blockName(block);
		if (name === "core/cover") {
			acc.cover += 1;
		} else if (name === "core/columns") {
			acc.columns += 1;
		} else if (name === "core/media-text") {
			acc.mediaText += 1;
		}
		if (block?.innerBlocks?.length) {
			countLayoutTypes(block.innerBlocks, acc);
		}
	}
	return acc;
}

/**
 * Width rules for top-level groups: color bands vs flow.
 *
 * @param {Array} blocks Top-level parsed blocks.
 * @return {string|null} Error message, or null when valid.
 */
export function getRichPageWidthError(blocks) {
	if (!Array.isArray(blocks)) {
		return null;
	}
	for (const block of blocks) {
		if (blockName(block) !== "core/group") {
			continue;
		}
		const attrs = blockAttrs(block);
		const bg = typeof attrs.backgroundColor === "string" ? attrs.backgroundColor : "";
		const align = attrs.align;
		const layoutType = attrs.layout && attrs.layout.type;

		if (bg) {
			if (align !== "full" || layoutType !== "constrained") {
				return RICH_BAND_WIDTH_ERROR;
			}
			const children = block.innerBlocks || [];
			for (const child of children) {
				if (blockAttrs(child).align === "full") {
					return RICH_BAND_CHILD_FULL_ERROR;
				}
			}
		} else if (align === "full") {
			return RICH_FLOW_WIDTH_ERROR;
		}
	}
	return null;
}

/**
 * Variety + width checks after the thin-layout floor.
 *
 * @param {Array} blocks Parsed Gutenberg blocks.
 * @return {string|null} First failure message, or null when valid.
 */
export function getRichPageStructureError(blocks) {
	const types = countLayoutTypes(blocks);
	if (types.cover < 1) {
		return RICH_COVER_ERROR;
	}
	if (types.mediaText < 1) {
		return RICH_MEDIA_TEXT_ERROR;
	}
	if (types.columns < 1) {
		return RICH_COLUMNS_ERROR;
	}
	return getRichPageWidthError(blocks);
}

/**
 * Validate and normalize block markup on entity create/update args.
 * Mutates `args.content` in place when validation succeeds.
 *
 * @param {string} toolName Hyphen-form ability name.
 * @param {Object} args     Ability parameters (mutated on success).
 * @param {Object} [intent] Classified user intent (layout skip for text_only pages).
 * @return {{ ok: true } | { ok: false, error: string }} Validation outcome.
 */
export function validateEntityContentArgs(toolName, args, intent) {
	if (!abilityUsesBlockContent(toolName)) {
		return { ok: true };
	}

	const raw = resolveContentField(args);
	if (!raw || typeof raw !== "string") {
		return { ok: true };
	}

	const content = raw.replace(/\\"/g, '"');
	const validation = validateBlockMarkup(content);
	if (!validation.valid) {
		return { ok: false, error: validation.error };
	}

	if (toolName === "blu-add-page" && shouldRequireRichPageLayout(intent?.layout)) {
		const blocks = validation.blocks || [];
		if (!isRichPageLayout(blocks)) {
			return { ok: false, error: RICH_LAYOUT_ERROR };
		}
		const structureError = getRichPageStructureError(blocks);
		if (structureError) {
			return { ok: false, error: structureError };
		}
	}

	args.content = validation.correctedContent || content;
	return { ok: true };
}
