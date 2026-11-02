import { requireEditorStore, serializeBlock } from "./editor-store";

const GET_EDITOR_TREE = "blu-editor/get-editor-tree";

/**
 * Register the Task 1 block-tree ability.
 *
 * @param {function(Object): boolean} register Ability registrar.
 * @return {string[]} Successfully registered names.
 */
export function registerBlockTreeAbilities(register) {
	const registered = [];
	const definition = {
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
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async ({ maxDepth } = {}) => {
			if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 0)) {
				throw new Error("maxDepth must be zero or greater.");
			}

			const store = requireEditorStore();
			const depthLimit = maxDepth === undefined ? Infinity : maxDepth;
			const blocks = store.getBlocks().map((block) => serializeBlock(store, block, depthLimit));
			return { blocks, count: blocks.length };
		},
	};

	if (register(definition)) {
		registered.push(GET_EDITOR_TREE);
	}
	return registered;
}
