/**
 * Local (in-browser) block editor abilities.
 *
 * These run in the browser against the live block editor stores and are
 * discoverable via @wordpress/abilities (and WebMCP via webmcp-bridge.js).
 *
 * This covers Rollout Stage 1 (editor/get-editor-tree) and Stage 2's
 * block-tree read family (editor/find-editor-blocks, editor/get-block-location,
 * editor/get-editor-selection, editor/can-insert-block) — see
 * docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md and
 * docs/superpowers/specs/2026-09-14-local-editor-abilities-stage2-block-tree-reads-design.md.
 * Block types and patterns are added the same way in later plans.
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
 * Describe a block without its nested subtree, for flat list results.
 *
 * @param {Object} store Block editor store selectors.
 * @param {Object} block
 * @return {Object} A flat block summary.
 */
function summarizeBlock(store, block) {
	const { innerBlocks, controlled } = getInnerBlocks(store, block);
	const summary = {
		clientId: block.clientId,
		name: block.name,
		attributes: block.attributes ?? {},
		innerBlockCount: innerBlocks.length,
	};
	if (controlled) {
		summary.controlledInnerBlocks = true;
	}
	return summary;
}

/**
 * Walk the block tree and collect matches as flat summaries. Matched blocks
 * are still descended into, so a match nested inside a match is reported
 * once each.
 *
 * @param {Object}                     store         Block editor store selectors.
 * @param {Object[]}                   blocks
 * @param {(block: Object) => boolean} predicate
 * @param {Object[]}                   [matches]
 * @param {Set<any>}                   [visitedRefs] Pattern entities on the current path.
 * @return {Object[]} Flat summaries of matching blocks.
 */
function collectBlocks(store, blocks, predicate, matches = [], visitedRefs = new Set()) {
	for (const block of blocks) {
		if (predicate(block)) {
			matches.push(summarizeBlock(store, block));
		}

		const { innerBlocks, controlled } = getInnerBlocks(store, block);
		if (!innerBlocks.length) {
			continue;
		}

		const childRefs = controlled ? withControlledRef(block, visitedRefs) : visitedRefs;
		if (childRefs === null) {
			continue;
		}

		collectBlocks(store, innerBlocks, predicate, matches, childRefs);
	}
	return matches;
}

/**
 * Compare an attribute against the requested value as a string. Objects and
 * arrays are compared as JSON so equivalent structures still match.
 *
 * @param {*}      attributeValue
 * @param {string} expected
 * @return {boolean} Whether the attribute matches the expected value.
 */
function attributeMatchesValue(attributeValue, expected) {
	if (attributeValue === null || attributeValue === undefined) {
		return false;
	}
	if (typeof attributeValue === "object") {
		return JSON.stringify(attributeValue) === expected;
	}
	return String(attributeValue) === expected;
}

/**
 * Reduce a rich-text attribute to searchable text so a phrase typed by a
 * person can match markup like "<strong>Chloe Nolan</strong>" or
 * "Founder &amp; CEO".
 *
 * @param {string} value
 * @return {string} The cleaned searchable text.
 */
function toSearchableText(value) {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")
		.toLowerCase();
}

/**
 * Case-insensitive substring match against every string attribute of a block.
 *
 * @param {Object} block
 * @param {string} search
 * @return {boolean} Whether the block matches the search term.
 */
function blockMatchesSearch(block, search) {
	const needle = search.toLowerCase();
	return Object.values(block.attributes || {}).some((value) => {
		if (typeof value !== "string") {
			return false;
		}
		return value.toLowerCase().includes(needle) || toSearchableText(value).includes(needle);
	});
}

/**
 * Resolve a client ID to a block, throwing when it is missing or unknown.
 *
 * @param {Object} store    Block editor store selectors.
 * @param {string} clientId
 * @param {string} [label]  Input field name, used in the error message.
 * @return {Object} The resolved block.
 */
function requireBlock(store, clientId, label = "clientId") {
	const block = clientId ? store.getBlock(clientId) : null;
	if (!block) {
		throw new Error(`Block not found for ${label}: ${clientId}`);
	}
	return block;
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

	ensureAbility({
		name: "editor/find-editor-blocks",
		label: "Find Editor Blocks",
		description: "Finds blocks in the editor by visible text, block name, and/or attribute value.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				search: {
					type: "string",
					description:
						"Text to look for in the block attributes, matched case-insensitively as a substring and ignoring HTML markup. Use this to find a block by the words shown in the editor.",
				},
				name: {
					type: "string",
					description: "Block name to match (e.g. core/paragraph). Omit to match any name.",
				},
				attribute: {
					type: "string",
					description:
						"Attribute key that must be present on the block. Omit value to match on presence alone.",
				},
				value: {
					type: "string",
					description:
						"Exact attribute value to match, requires attribute. Compared as a string; objects and arrays are compared as JSON. Without attribute it is treated as search.",
				},
				clientId: {
					type: "string",
					description:
						"Optional client ID to search within, including the block itself. Defaults to the full document.",
				},
			},
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				blocks: {
					type: "array",
					description: "Flat list of matching blocks, without their nested subtrees.",
				},
				count: { type: "integer" },
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
		callback: async (input = {}) => {
			assertEditorReady();
			const { select } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const roots = input.clientId ? [requireBlock(store, input.clientId)] : store.getBlocks();

			// A value without an attribute is a text search, never "no filter".
			const search = input.search ?? (input.attribute ? undefined : input.value);

			const matches = collectBlocks(store, roots, (block) => {
				if (input.name && block.name !== input.name) {
					return false;
				}
				if (input.attribute) {
					const attributes = block.attributes || {};
					if (!(input.attribute in attributes)) {
						return false;
					}
					if (
						input.value !== undefined &&
						!attributeMatchesValue(attributes[input.attribute], input.value)
					) {
						return false;
					}
				}
				if (search && !blockMatchesSearch(block, search)) {
					return false;
				}
				return true;
			});

			return { blocks: matches, count: matches.length };
		},
	});
	abilityNames.push("editor/find-editor-blocks");

	ensureAbility({
		name: "editor/get-block-location",
		label: "Get Block Location",
		description: "Returns the hierarchical location of a block (parents, root, and index).",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				clientId: {
					type: "string",
					description: "Client ID of the block to locate.",
				},
			},
			required: ["clientId"],
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				clientId: { type: "string" },
				name: { type: "string" },
				rootClientId: { type: ["string", "null"] },
				index: { type: "integer" },
				parentClientIds: { type: "array" },
				path: { type: "array" },
			},
			required: ["clientId", "index", "parentClientIds", "path"],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async ({ clientId } = {}) => {
			assertEditorReady();
			const { select } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const block = requireBlock(store, clientId);

			const parentClientIds = store.getBlockParents(clientId) || [];
			const rootClientId = store.getBlockRootClientId(clientId);
			const index = store.getBlockIndex(clientId);

			const path = [...parentClientIds, clientId].map((id) => {
				const node = store.getBlock(id);
				return {
					clientId: id,
					name: node?.name ?? null,
					index: store.getBlockIndex(id),
				};
			});

			return {
				clientId,
				name: block.name,
				rootClientId: rootClientId || null,
				index,
				parentClientIds,
				path,
			};
		},
	});
	abilityNames.push("editor/get-block-location");

	ensureAbility({
		name: "editor/get-editor-selection",
		label: "Get Editor Selection",
		description: "Returns the current block and rich-text selection in the editor.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				selectedBlockClientId: { type: ["string", "null"] },
				selectedBlockClientIds: { type: "array" },
				selectionStart: { type: ["object", "null"] },
				selectionEnd: { type: ["object", "null"] },
				selectedBlock: { type: ["object", "null"] },
			},
			required: [
				"selectedBlockClientId",
				"selectedBlockClientIds",
				"selectionStart",
				"selectionEnd",
			],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async () => {
			assertEditorReady();
			const { select } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const selectedBlockClientId = store.getSelectedBlockClientId() || null;
			const selectedBlockClientIds = store.getSelectedBlockClientIds() || [];
			const selectionStart = store.getSelectionStart() || null;
			const selectionEnd = store.getSelectionEnd() || null;
			// The selection can reference a block that is already gone.
			const selectedBlock = selectedBlockClientId ? store.getBlock(selectedBlockClientId) : null;

			return {
				selectedBlockClientId,
				selectedBlockClientIds,
				selectionStart,
				selectionEnd,
				selectedBlock: selectedBlock ? serializeBlock(store, selectedBlock) : null,
			};
		},
	});
	abilityNames.push("editor/get-editor-selection");

	return abilityNames;
}
