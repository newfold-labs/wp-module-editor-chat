import { requireBlock, requireEditorStore } from "./editor-store";

const BLOCKS_STORE = "core/blocks";

const READ_ONLY_META = {
	annotations: {
		readonly: true,
		destructive: false,
		idempotent: true,
	},
};

function requireBlockRegistry() {
	const select = window.wp?.data?.select;
	if (typeof select !== "function") {
		throw new Error("WordPress data store is not available.");
	}
	const registry = select(BLOCKS_STORE);
	if (!registry || typeof registry.getBlockTypes !== "function") {
		throw new Error("Block type registry is not available.");
	}
	return registry;
}

function summarizeBlockType(blockType) {
	const summary = {
		name: blockType.name,
		title: blockType.title ?? blockType.name,
		category: blockType.category ?? null,
		description: blockType.description ?? "",
	};
	for (const key of ["parent", "ancestor", "allowedBlocks"]) {
		if (Array.isArray(blockType[key])) {
			summary[key] = blockType[key];
		}
	}
	return summary;
}

function summarizeStyles(registry, name, blockType) {
	const styles = registry.getBlockStyles?.(name) ?? blockType.styles ?? [];
	return styles.map((style) => ({
		name: style.name,
		label: style.label ?? style.name,
		isDefault: !!style.isDefault,
		className: `is-style-${style.name}`,
	}));
}

function summarizeVariations(registry, name, blockType) {
	const variations = registry.getBlockVariations?.(name) ?? blockType.variations ?? [];
	return variations.map((variation) => ({
		name: variation.name,
		title: variation.title ?? variation.name,
		description: variation.description ?? "",
		isDefault: !!variation.isDefault,
		attributes: variation.attributes ?? {},
		innerBlocks: variation.innerBlocks ?? [],
	}));
}

export function registerBlockCatalogAbilities(register) {
	const definitions = [
		{
			name: "blu-editor/get-block-types",
			label: "Get Block Types",
			description: "Lists block types registered in the live editor.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					search: { type: "string" },
					category: { type: "string" },
					rootClientId: { type: "string" },
					insertableOnly: { type: "boolean" },
					includeHidden: { type: "boolean" },
				},
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					blockTypes: { type: "array" },
					count: { type: "integer" },
					totalCount: { type: "integer" },
				},
				required: ["blockTypes", "count", "totalCount"],
			},
			meta: READ_ONLY_META,
			callback: async (input = {}) => {
				const registry = requireBlockRegistry();
				const editorStore = requireEditorStore();
				if (input.rootClientId) {
					requireBlock(editorStore, input.rootClientId, "rootClientId");
				}

				const all = registry.getBlockTypes() || [];
				const categories = registry.getCategories?.() || [];
				if (
					input.category &&
					categories.length &&
					!categories.some((category) => (category.slug ?? category.name) === input.category)
				) {
					throw new Error(`Unknown block category "${input.category}"`);
				}

				const needle = input.search?.toLowerCase();
				const filterInsertable = !!input.insertableOnly || !!input.rootClientId;
				const matches = all
					.filter((blockType) => {
						if (!input.includeHidden && blockType.supports?.inserter === false) {
							return false;
						}
						if (input.category && blockType.category !== input.category) {
							return false;
						}
						if (needle) {
							const haystack = [blockType.name, blockType.title, ...(blockType.keywords || [])]
								.join(" ")
								.toLowerCase();
							if (!haystack.includes(needle)) {
								return false;
							}
						}
						return (
							!filterInsertable ||
							!!editorStore.canInsertBlockType(blockType.name, input.rootClientId || undefined)
						);
					})
					.map(summarizeBlockType)
					.sort((a, b) => a.name.localeCompare(b.name));

				return { blockTypes: matches, count: matches.length, totalCount: all.length };
			},
		},
		{
			name: "blu-editor/get-block-type",
			label: "Get Block Type",
			description: "Returns the full live definition of one registered block type.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: { name: { type: "string" } },
				required: ["name"],
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					name: { type: "string" },
					title: { type: "string" },
					category: { type: ["string", "null"] },
					description: { type: "string" },
					keywords: { type: "array" },
					attributes: { type: "object" },
					supports: { type: "object" },
					parent: { type: ["array", "null"] },
					ancestor: { type: ["array", "null"] },
					allowedBlocks: { type: ["array", "null"] },
					styles: { type: "array" },
					variations: { type: "array" },
				},
				required: ["name", "title", "attributes"],
			},
			meta: READ_ONLY_META,
			callback: async ({ name } = {}) => {
				const registry = requireBlockRegistry();
				const blockType = typeof name === "string" && name ? registry.getBlockType?.(name) : null;
				if (!blockType) {
					throw new Error(`Unknown block type "${name ?? ""}"`);
				}
				return {
					name: blockType.name,
					title: blockType.title ?? blockType.name,
					category: blockType.category ?? null,
					description: blockType.description ?? "",
					keywords: blockType.keywords ?? [],
					attributes: blockType.attributes ?? {},
					supports: blockType.supports ?? {},
					parent: blockType.parent ?? null,
					ancestor: blockType.ancestor ?? null,
					allowedBlocks: blockType.allowedBlocks ?? null,
					styles: summarizeStyles(registry, name, blockType),
					variations: summarizeVariations(registry, name, blockType),
				};
			},
		},
	];

	return definitions.filter((definition) => register(definition)).map(({ name }) => name);
}
