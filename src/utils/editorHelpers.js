/**
 * Editor state helpers.
 *
 * Read-only utilities for building AI context: block tree, page content,
 * selection state, and block markup. Template-part entity CRUD lives in
 * services/templatePartEditor.js; linked navigation menus in navigationEditor.js.
 */
import { select } from "@wordpress/data";
import { serialize, getBlockTypes } from "@wordpress/blocks";

/**
 * Container block name → the block types that may be its direct children.
 *
 * Derived from each block type's own `parent` declaration (core/column declares
 * parent core/columns, core/button declares core/buttons, …) so it stays right
 * as blocks are added or changed, rather than being a list we maintain here.
 *
 * Built once per page load: getBlockTypes() is a full registry scan and the
 * tree is rebuilt on every turn.
 *
 * @type {Map<string, string[]>|null}
 */
let restrictedChildCache = null;

function getRestrictedChildMap() {
	if (restrictedChildCache) {
		return restrictedChildCache;
	}
	const map = new Map();
	for (const type of getBlockTypes()) {
		for (const parent of type.parent || []) {
			map.set(parent, [...(map.get(parent) || []), type.name]);
		}
	}
	restrictedChildCache = map;
	return map;
}

/**
 * Placement facts about one block, as short tags for the AI context tree.
 *
 * The tree used to carry only name, id and a text preview, so every structural
 * decision — what a container accepts, how it lays its children out, whether an
 * image is real — was a guess. Each tag below exists because guessing it wrong
 * produced a silent failure: content inserted into a container that refuses it,
 * a new column rendered at zero width, a broken placeholder copied forward.
 *
 * @param {Object} block Block object from the editor store.
 * @return {string} Space-prefixed tags, or "" when nothing is noteworthy.
 */
function describeBlockStructure(block) {
	const tags = [];
	const attrs = block.attributes || {};

	// What this container will actually accept as a direct child. Inserting
	// anything else is silently discarded by the editor.
	const allowed = getRestrictedChildMap().get(block.name);
	if (allowed?.length && block.innerBlocks) {
		tags.push(`accepts:${allowed.join("|")}`);
	}

	if (block.name === "core/columns") {
		const cols = (block.innerBlocks || []).filter((b) => b.name === "core/column");
		if (cols.length) {
			// Explicit widths leave no room for a column added without one.
			const widths = cols.map((c) => c.attributes?.width || "auto");
			tags.push(`cols:${cols.length}`, `widths:${widths.join("/")}`);
			if (widths.every((w) => w !== "auto")) {
				tags.push("widths-explicit");
			}
		}
		tags.push(block.attributes?.isStackedOnMobile === false ? "no-stack" : "side-by-side");
	}

	if (block.name === "core/column" && attrs.width) {
		tags.push(`w:${attrs.width}`);
	}

	// Flow vs flex decides whether a new child lands beside or below the others.
	const layoutType = attrs.layout?.type;
	if (layoutType === "flex") {
		tags.push(attrs.layout?.orientation === "vertical" ? "layout:stack" : "layout:row");
	} else if (layoutType === "grid") {
		tags.push("layout:grid");
	} else if (block.name === "core/group" || block.name === "core/column") {
		tags.push("layout:stacked");
	}

	// A placeholder here is a broken image from an earlier failed edit, not a URL.
	if (block.name === "core/image" || block.name === "core/cover") {
		const src = attrs.url || "";
		if (!src) {
			tags.push("img:EMPTY");
		} else if (/__(?:IMG|IMAGE)_?\d*__/i.test(src)) {
			tags.push("img:BROKEN-PLACEHOLDER");
		}
	}

	return tags.length ? ` {${tags.join(" ")}}` : "";
}

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
		// Navigation links use label (and optionally url for custom links)
		if (block.name === "core/navigation-link" || block.name === "core/navigation-submenu") {
			const label = block.attributes?.label;
			if (label) {
				const trimmed = label.length > 30 ? label.substring(0, 30) + "…" : label;
				const url = block.attributes?.url;
				if (url && !block.attributes?.id) {
					return `${trimmed} → ${url.length > 24 ? url.substring(0, 24) + "…" : url}`;
				}
				if (block.attributes?.type && block.attributes?.id) {
					return `${trimmed} (${block.attributes.type}:${block.attributes.id})`;
				}
				return trimmed;
			}
		}

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

	// Recursive inner block count (all levels)
	const countInnerBlocks = (block) => {
		if (!block.innerBlocks || block.innerBlocks.length === 0) {
			return 0;
		}
		return block.innerBlocks.reduce((sum, ib) => sum + 1 + countInnerBlocks(ib), 0);
	};

	const walkBlocks = (blockList, prefix = "", depth = 0, insideSelected = false) => {
		blockList.forEach((block, index) => {
			const indexPath = prefix ? `${prefix}.${index}` : `${index}`;
			const isSelected = selectedSet.has(block.clientId);
			const selectedMarker = isSelected ? " [SELECTED]" : "";
			const innerCount = countInnerBlocks(block);
			const largeMarker = innerCount >= 40 ? " [LARGE]" : "";

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

			// Linked navigation menu (wp_navigation entity) — internal context only
			if (block.name === "core/navigation" && block.attributes?.ref) {
				line += " linked-menu";
			}

			// Add text preview
			const preview = extractTextPreview(block);
			if (preview) {
				line += ` → "${preview}"`;
			}

			line += describeBlockStructure(block);
			line += largeMarker + selectedMarker;
			lines.push(line);

			// Recurse into inner blocks.
			// Always expand children of selected blocks and navigation menus.
			if (block.innerBlocks && block.innerBlocks.length > 0) {
				const expandChildren = isSelected || insideSelected || block.name === "core/navigation";
				if (hasSelection && !expandChildren && !subtreeHasSelected(block.innerBlocks)) {
					lines.push(`${"  ".repeat(depth + 1)}... (${block.innerBlocks.length} inner blocks)`);
				} else {
					walkBlocks(block.innerBlocks, indexPath, depth + 1, expandChildren);
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

	// These serialize to self-closing comments; return their inner blocks so
	// the AI has something to edit.
	let blockContent;
	if (
		block.name === "core/template-part" ||
		block.name === "core/navigation" ||
		block.name === "core/post-content"
	) {
		const innerBlocks = blockEditor.getBlocks(clientId);
		blockContent = innerBlocks.map((b) => serialize(b)).join("\n");
		if (!blockContent && block.name === "core/navigation" && block.attributes?.ref) {
			const entity = select("core").getEntityRecord(
				"postType",
				"wp_navigation",
				block.attributes.ref
			);
			const raw = entity?.content?.raw || entity?.content?.rendered || entity?.content || "";
			blockContent = typeof raw === "string" ? raw : "";
		}
	} else {
		blockContent = serialize(block);
	}

	return {
		block_content: blockContent,
		block_name: block.name,
		client_id: clientId,
	};
};

const maybeLoadInnerBlocks = (block) => {
	const CONTAINERS = ["core/post-content", "core/template-part", "core/group", "core/navigation"];
	const blockEditor = select("core/block-editor");

	if (CONTAINERS.includes(block.name)) {
		if (typeof block.innerBlocks === "undefined" || block.innerBlocks.length < 1) {
			const innerBlocks = blockEditor.getBlocks(block.clientId).map(maybeLoadInnerBlocks);
			return {
				...block,
				innerBlocks,
			};
		}
		return {
			...block,
			innerBlocks: block.innerBlocks.map(maybeLoadInnerBlocks),
		};
	}
	return block;
};

/**
 * Get the current page blocks (with inner blocks resolved for post-content / template parts).
 *
 * @return {Array} Processed block list
 */
export const getCurrentPageBlocks = () => {
	const blockEditor = select("core/block-editor");

	const blocks = blockEditor.getBlocks();

	return blocks.map(maybeLoadInnerBlocks);
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
