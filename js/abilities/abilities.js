/**
 * Local (in-browser) block editor abilities.
 *
 * These run in the browser against the live block editor stores and are
 * discoverable via @wordpress/abilities (and WebMCP via webmcp-bridge.js).
 *
 * This is Rollout Stage 1 (see docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md):
 * only editor/get-editor-tree exists so far. More abilities are added the
 * same way in later plans.
 */

import {
	getAbility,
	getAbilityCategory,
	registerAbility,
	registerAbilityCategory,
} from "@wordpress/abilities";

const BLOCK_EDITOR_STORE = "core/block-editor";

/**
 * @return {{ select: Function, dispatch: Function }} The WordPress data store's select and dispatch.
 */
function getData() {
	const { data } = window.wp || {};
	if (!data?.select || !data?.dispatch) {
		throw new Error(
			"WordPress data store is not available. Open this ability in the block editor."
		);
	}
	return data;
}

/**
 * Ensure the block editor store is mounted.
 */
function assertEditorReady() {
	const { select } = getData();
	if (!select(BLOCK_EDITOR_STORE)) {
		throw new Error(
			"Block editor store is not available. These abilities only work in the block editor."
		);
	}
}

/**
 * @param {Object} store Block editor store selectors.
 * @param {Object} block
 * @return {{ innerBlocks: Object[], controlled: boolean }} The block's inner blocks and whether they are controlled.
 */
function getInnerBlocks(store, block) {
	if (store?.areInnerBlocksControlled?.(block.clientId)) {
		return {
			innerBlocks: store.getBlocks(block.clientId) || [],
			controlled: true,
		};
	}
	return { innerBlocks: block.innerBlocks || [], controlled: false };
}

/**
 * Extend the set of pattern entities on the current path, so a pattern that
 * references itself (directly or through another pattern) cannot loop forever.
 *
 * @param {Object}   block
 * @param {Set<any>} visitedRefs
 * @return {?Set<any>} Set for the children, or null when this entity repeats.
 */
function withControlledRef(block, visitedRefs) {
	const ref = block.attributes?.ref;
	if (ref === undefined) {
		return visitedRefs;
	}
	if (visitedRefs.has(ref)) {
		return null;
	}
	return new Set(visitedRefs).add(ref);
}

/**
 * Serialize a block (and descendants) into a compact tree node.
 *
 * @param {Object}   store         Block editor store selectors.
 * @param {Object}   block
 * @param {number}   [maxDepth]    Depth of descendants to include.
 * @param {number}   [depth]
 * @param {Set<any>} [visitedRefs] Pattern entities on the current path.
 * @return {Object} The serialized block tree node.
 */
function serializeBlock(store, block, maxDepth = Infinity, depth = 0, visitedRefs = new Set()) {
	const { innerBlocks, controlled } = getInnerBlocks(store, block);
	const node = {
		clientId: block.clientId,
		name: block.name,
		attributes: block.attributes ?? {},
	};

	if (controlled) {
		node.controlledInnerBlocks = true;
	}

	const childRefs = controlled ? withControlledRef(block, visitedRefs) : visitedRefs;

	if (depth >= maxDepth || childRefs === null) {
		node.innerBlocks = [];
		node.truncatedInnerBlockCount = innerBlocks.length;
		return node;
	}

	node.innerBlocks = innerBlocks.map((innerBlock) =>
		serializeBlock(store, innerBlock, maxDepth, depth + 1, childRefs)
	);
	return node;
}

/**
 * @param {string} slug
 * @param {Object} args
 */
function ensureAbilityCategory(slug, args) {
	if (!getAbilityCategory(slug)) {
		registerAbilityCategory(slug, args);
	}
}

/**
 * Ensure an ability exists without throwing if it was already registered.
 *
 * @param {Object} ability
 */
function ensureAbility(ability) {
	if (!getAbility(ability.name)) {
		registerAbility(ability);
	}
}

/**
 * Register the block-editor category and local editor abilities.
 *
 * @return {string[]} Registered ability names.
 */
export function registerEditorAbilities() {
	ensureAbilityCategory("block-editor", {
		label: "Block Editor",
		description: "Abilities for inspecting and modifying the WordPress block editor.",
	});

	const abilityNames = [];

	ensureAbility({
		name: "editor/get-editor-tree",
		label: "Get Editor Tree",
		description: "Returns the full hierarchical block tree for the current editor document.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				maxDepth: {
					type: "integer",
					minimum: 0,
					description:
						"Levels of nested blocks to include. Omit for the whole tree. Truncated nodes report truncatedInnerBlockCount.",
				},
			},
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				blocks: {
					type: "array",
					description: "Top-level blocks and their descendants.",
				},
				count: {
					type: "integer",
					description: "Number of top-level blocks.",
				},
			},
			required: ["blocks", "count"],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async ({ maxDepth } = {}) => {
			assertEditorReady();
			const { select } = getData();

			if (maxDepth !== undefined && !(maxDepth >= 0)) {
				throw new Error("maxDepth must be zero or greater.");
			}

			const depthLimit = maxDepth === undefined ? Infinity : maxDepth;
			const store = select(BLOCK_EDITOR_STORE);
			const tree = store.getBlocks().map((block) => serializeBlock(store, block, depthLimit));
			return { blocks: tree, count: tree.length };
		},
	});
	abilityNames.push("editor/get-editor-tree");

	return abilityNames;
}
