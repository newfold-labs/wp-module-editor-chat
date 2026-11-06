import {
	getInnerBlocks,
	requireBlock,
	requireEditorStore,
	serializeBlock,
	withControlledRef,
} from "./editor-store.js";

const GET_EDITOR_TREE = "blu-editor/get-editor-tree";
const FIND_EDITOR_BLOCKS = "blu-editor/find-editor-blocks";
const GET_BLOCK_LOCATION = "blu-editor/get-block-location";
const GET_EDITOR_SELECTION = "blu-editor/get-editor-selection";
const CAN_INSERT_BLOCK = "blu-editor/can-insert-block";

const READ_ONLY_META = {
	annotations: {
		readonly: true,
		destructive: false,
		idempotent: true,
	},
};

/**
 * Return a flat summary suitable for search results.
 *
 * @param {Object} store Block-editor selectors.
 * @param {Object} block Block to summarize.
 * @return {Object} Block summary.
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
 * Walk ordinary and controlled inner blocks without following pattern loops.
 *
 * @param {Object}                     store       Block-editor selectors.
 * @param {Object[]}                   blocks      Blocks at the current depth.
 * @param {(block: Object) => boolean} predicate   Match predicate.
 * @param {number}                     maxDepth    Maximum depth to visit.
 * @param {Object[]}                   matches     Accumulated summaries.
 * @param {number}                     depth       Current depth.
 * @param {Set<unknown>}               visitedRefs Controlled refs on this path.
 * @return {Object[]} Matching block summaries.
 */
function collectBlocks(
	store,
	blocks,
	predicate,
	maxDepth = Infinity,
	matches = [],
	depth = 0,
	visitedRefs = new Set()
) {
	for (const block of blocks) {
		if (predicate(block)) {
			matches.push(summarizeBlock(store, block));
		}

		if (depth >= maxDepth) {
			continue;
		}

		const { innerBlocks, controlled } = getInnerBlocks(store, block);
		if (!innerBlocks.length) {
			continue;
		}

		const childRefs = controlled ? withControlledRef(block, visitedRefs) : visitedRefs;
		if (childRefs !== null) {
			collectBlocks(store, innerBlocks, predicate, maxDepth, matches, depth + 1, childRefs);
		}
	}
	return matches;
}

/**
 * Normalize rich text to visible searchable text.
 *
 * @param {string} value Attribute value.
 * @return {string} Searchable text.
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
 * Match visible text against string attributes.
 *
 * @param {Object} block  Block to inspect.
 * @param {string} search Search text.
 * @return {boolean} Whether the block matches.
 */
function blockMatchesSearch(block, search) {
	const needle = search.toLowerCase();
	return Object.values(block.attributes || {}).some(
		(value) =>
			typeof value === "string" &&
			(value.toLowerCase().includes(needle) || toSearchableText(value).includes(needle))
	);
}

/**
 * Compare an attribute with a public string input.
 *
 * @param {unknown} value    Attribute value.
 * @param {string}  expected Expected value.
 * @return {boolean} Whether values match.
 */
function attributeMatchesValue(value, expected) {
	if (value === null || value === undefined) {
		return false;
	}
	return (typeof value === "object" ? JSON.stringify(value) : String(value)) === expected;
}

/**
 * Register block-tree and selection read abilities.
 *
 * @param {function(Object): boolean} register Ability registrar.
 * @return {string[]} Successfully registered names.
 */
export function registerBlockTreeAbilities(register) {
	const registered = [];
	const definitions = [
		{
			name: GET_EDITOR_TREE,
			label: "Get Editor Tree",
			description: "Returns the full hierarchical block tree for the current editor document.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					maxDepth: {
						type: "integer",
						minimum: 0,
						description: "Levels of nested blocks to include. Omit for the whole tree.",
					},
				},
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					blocks: { type: "array" },
					count: { type: "integer" },
				},
				required: ["blocks", "count"],
			},
			meta: READ_ONLY_META,
			callback: async ({ maxDepth } = {}) => {
				if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
					throw new Error("maxDepth must be zero or greater.");
				}

				const store = requireEditorStore();
				const depthLimit = maxDepth === undefined ? Infinity : maxDepth;
				const blocks = store.getBlocks().map((block) => serializeBlock(store, block, depthLimit));
				return { blocks, count: blocks.length };
			},
		},
		{
			name: FIND_EDITOR_BLOCKS,
			label: "Find Editor Blocks",
			description:
				"Finds blocks in the editor by visible text, block name, and/or attribute value.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					search: { type: "string" },
					name: { type: "string" },
					attribute: { type: "string" },
					value: { type: "string" },
					rootClientId: { type: "string" },
					maxDepth: { type: "integer", minimum: 0 },
				},
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					blocks: { type: "array" },
					count: { type: "integer" },
				},
				required: ["blocks", "count"],
			},
			meta: READ_ONLY_META,
			callback: async (input = {}) => {
				if (
					input.maxDepth !== undefined &&
					(!Number.isInteger(input.maxDepth) || input.maxDepth < 0)
				) {
					throw new Error("maxDepth must be zero or greater.");
				}

				const store = requireEditorStore();
				const roots =
					input.rootClientId !== undefined
						? [requireBlock(store, input.rootClientId, "rootClientId")]
						: store.getBlocks();
				const search = input.search ?? (input.attribute ? undefined : input.value);
				const matches = collectBlocks(
					store,
					roots,
					(block) => {
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
						return !search || blockMatchesSearch(block, search);
					},
					input.maxDepth === undefined ? Infinity : input.maxDepth
				);
				return { blocks: matches, count: matches.length };
			},
		},
		{
			name: GET_BLOCK_LOCATION,
			label: "Get Block Location",
			description: "Returns the hierarchical location of a block.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: { clientId: { type: "string" } },
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
				required: ["clientId", "name", "rootClientId", "index", "parentClientIds", "path"],
			},
			meta: READ_ONLY_META,
			callback: async ({ clientId } = {}) => {
				const store = requireEditorStore();
				const block = requireBlock(store, clientId);
				const parentClientIds = store.getBlockParents(clientId) || [];
				const rootClientId = store.getBlockRootClientId(clientId);
				const index = store.getBlockIndex(clientId);
				const path = [...parentClientIds, clientId].map((id) => ({
					clientId: id,
					name: store.getBlock(id)?.name ?? null,
					index: store.getBlockIndex(id),
				}));
				return {
					clientId,
					name: block.name,
					rootClientId: rootClientId || null,
					index,
					parentClientIds,
					path,
				};
			},
		},
		{
			name: GET_EDITOR_SELECTION,
			label: "Get Editor Selection",
			description: "Returns the current block and rich-text selection in the editor.",
			category: "blu-editor",
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
					"selectedBlock",
				],
			},
			meta: READ_ONLY_META,
			callback: async () => {
				const store = requireEditorStore();
				const selectedBlockClientId = store.getSelectedBlockClientId() || null;
				const selectedBlockClientIds = store.getSelectedBlockClientIds() || [];
				const selectionStart = store.getSelectionStart() || null;
				const selectionEnd = store.getSelectionEnd() || null;
				const selectedBlock = selectedBlockClientId ? store.getBlock(selectedBlockClientId) : null;
				return {
					selectedBlockClientId,
					selectedBlockClientIds,
					selectionStart,
					selectionEnd,
					selectedBlock: selectedBlock ? serializeBlock(store, selectedBlock) : null,
				};
			},
		},
		{
			name: CAN_INSERT_BLOCK,
			label: "Can Insert Block",
			description: "Checks whether a block type can be inserted at a given editor location.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					name: { type: "string" },
					rootClientId: { type: "string" },
				},
				required: ["name"],
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					canInsert: { type: "boolean" },
					name: { type: "string" },
					rootClientId: { type: ["string", "null"] },
				},
				required: ["canInsert", "name", "rootClientId"],
			},
			meta: READ_ONLY_META,
			callback: async ({ name, rootClientId } = {}) => {
				const store = requireEditorStore();
				if (rootClientId !== undefined) {
					requireBlock(store, rootClientId, "rootClientId");
				}
				const normalizedRootClientId = rootClientId || null;
				return {
					name,
					rootClientId: normalizedRootClientId,
					canInsert: !!store.canInsertBlockType(name, normalizedRootClientId || undefined),
				};
			},
		},
	];

	for (const definition of definitions) {
		if (register(definition)) {
			registered.push(definition.name);
		}
	}
	return registered;
}
