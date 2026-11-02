import { requireBlock, requireEditorStore } from "./editor-store";
import {
	countPatternBlocks,
	getPatternStructure,
	listPatternCategories,
	loadPatterns,
	parsePatternContent,
	requirePattern,
	serializePatternBlock,
	summarizePattern,
} from "./pattern-store";

const READ_ONLY_META = {
	annotations: {
		readonly: true,
		destructive: false,
		idempotent: true,
	},
};

export function registerPatternReadAbilities(register) {
	const definitions = [
		{
			name: "blu-editor/get-patterns",
			label: "Get Patterns",
			description: "Lists registered and user-created block patterns available in the editor.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					search: { type: "string" },
					category: { type: "string" },
					blockTypes: { type: "array", items: { type: "string" } },
					source: { type: "string" },
					syncStatus: { type: "string", enum: ["synced", "unsynced"] },
					rootClientId: { type: "string" },
					includeHidden: { type: "boolean" },
				},
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					patterns: { type: "array" },
					count: { type: "integer" },
					totalCount: { type: "integer" },
				},
				required: ["patterns", "count", "totalCount"],
			},
			meta: READ_ONLY_META,
			callback: async (input = {}) => {
				const editorStore = requireEditorStore();
				if (input.rootClientId) {
					requireBlock(editorStore, input.rootClientId, "rootClientId");
				}
				if (input.blockTypes !== undefined && !Array.isArray(input.blockTypes)) {
					throw new Error("blockTypes must be an array of block names.");
				}

				const all = await loadPatterns();
				const needle = input.search?.toLowerCase();
				const matches = all
					.filter((pattern) => {
						if (!input.includeHidden && !pattern.inserter) {
							return false;
						}
						if (
							input.source &&
							pattern.source !== input.source &&
							!pattern.source?.startsWith(`${input.source}/`)
						) {
							return false;
						}
						if (input.syncStatus && pattern.syncStatus !== input.syncStatus) {
							return false;
						}
						if (input.category && !pattern.categories.includes(input.category)) {
							return false;
						}
						if (
							input.blockTypes?.length &&
							!input.blockTypes.some((blockType) => pattern.blockTypes.includes(blockType))
						) {
							return false;
						}
						if (needle) {
							const haystack = [
								pattern.name,
								pattern.title,
								pattern.description,
								...pattern.categories,
							]
								.join(" ")
								.toLowerCase();
							if (!haystack.includes(needle)) {
								return false;
							}
						}
						if (input.rootClientId) {
							const { rootBlockNames } = getPatternStructure(pattern);
							return (
								rootBlockNames.length > 0 &&
								rootBlockNames.every((name) =>
									editorStore.canInsertBlockType(name, input.rootClientId)
								)
							);
						}
						return true;
					})
					.map(summarizePattern)
					.sort((a, b) => a.title.localeCompare(b.title));

				return { patterns: matches, count: matches.length, totalCount: all.length };
			},
		},
		{
			name: "blu-editor/get-pattern",
			label: "Get Pattern",
			description: "Returns one pattern as a parsed block tree.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					name: { type: "string" },
					maxDepth: { type: "integer", minimum: 0 },
					includeContent: { type: "boolean" },
				},
				required: ["name"],
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					name: { type: "string" },
					title: { type: "string" },
					description: { type: "string" },
					source: { type: ["string", "null"] },
					isUserPattern: { type: "boolean" },
					id: { type: ["integer", "null"] },
					syncStatus: { type: ["string", "null"] },
					categories: { type: "array" },
					blockTypes: { type: "array" },
					blockCount: { type: "integer" },
					blocks: { type: "array" },
					content: { type: "string" },
				},
				required: ["name", "title", "blocks", "blockCount"],
			},
			meta: READ_ONLY_META,
			callback: async (input = {}) => {
				if (
					input.maxDepth !== undefined &&
					(!Number.isInteger(input.maxDepth) || input.maxDepth < 0)
				) {
					throw new Error("maxDepth must be zero or greater.");
				}
				const pattern = await requirePattern(input.name);
				const blocks = parsePatternContent(pattern);
				const depthLimit = input.maxDepth === undefined ? Infinity : input.maxDepth;
				const result = {
					name: pattern.name,
					title: pattern.title,
					description: pattern.description,
					source: pattern.source,
					isUserPattern: pattern.isUserPattern,
					id: pattern.id,
					syncStatus: pattern.syncStatus,
					categories: pattern.categories,
					blockTypes: pattern.blockTypes,
					blockCount: countPatternBlocks(blocks),
					blocks: blocks.map((block) => serializePatternBlock(block, depthLimit)),
				};
				if (input.includeContent) {
					result.content = pattern.content;
				}
				return result;
			},
		},
		{
			name: "blu-editor/get-pattern-categories",
			label: "Get Pattern Categories",
			description: "Lists normalized registered and user pattern categories.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {},
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					categories: { type: "array" },
					count: { type: "integer" },
				},
				required: ["categories", "count"],
			},
			meta: READ_ONLY_META,
			callback: async () => {
				const categories = await listPatternCategories();
				return { categories, count: categories.length };
			},
		},
	];

	return definitions.filter((definition) => register(definition)).map(({ name }) => name);
}
