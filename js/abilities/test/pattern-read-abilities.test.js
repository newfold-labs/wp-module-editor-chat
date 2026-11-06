/* global afterEach, beforeAll, beforeEach, describe, expect, it, jest */

import { registerAbility } from "@wordpress/abilities";

import { initializeEditorAbilities } from "../index";

const getDefinition = (name) =>
	registerAbility.mock.calls.find(([ability]) => ability.name === name)?.[0];

const execute = (name, input = {}) => {
	const definition = getDefinition(name);
	if (!definition) {
		throw new Error(`Ability "${name}" is not registered.`);
	}
	return definition.callback(input);
};

const registeredPatterns = [
	{
		name: "theme/hero",
		title: "Hero",
		description: "A large image and heading.",
		source: "theme",
		categories: ["featured", "pages"],
		content: "<!-- wp:cover --><div>Hero</div><!-- /wp:cover -->",
		blockTypes: ["core/post-content"],
	},
	{
		name: "theme/footer",
		title: "Footer",
		categories: ["footer"],
		content: "<!-- wp:group --><div>Footer</div><!-- /wp:group -->",
	},
];

const patternCategories = [
	{ name: "featured", label: "Featured" },
	{ name: "pages", label: "Pages" },
	{ name: "footer", label: "Footers" },
];

const userPatterns = [
	{
		id: 41,
		title: { raw: "Callout" },
		content: { raw: "<!-- wp:group --><div>Callout</div><!-- /wp:group -->" },
		meta: { wp_pattern_sync_status: "unsynced" },
		wp_pattern_category: [7],
	},
	{
		id: 42,
		title: { raw: "Reusable notice" },
		content: { raw: "<!-- wp:paragraph --><p>Notice</p><!-- /wp:paragraph -->" },
		meta: {},
		wp_pattern_category: [],
	},
];

const userCategories = [{ id: 7, slug: "marketing", name: "Marketing" }];

describe("pattern read abilities", () => {
	beforeAll(async () => {
		await initializeEditorAbilities();
	});

	beforeEach(() => {
		const editorStore = {
			getBlock: jest.fn((clientId) =>
				clientId === "group-1" ? { clientId, name: "core/group" } : null
			),
			canInsertBlockType: jest.fn((name) => name !== "core/cover"),
		};
		const coreStore = {
			getBlockPatterns: jest.fn().mockReturnValue(registeredPatterns),
			getBlockPatternCategories: jest.fn().mockReturnValue(patternCategories),
			getEntityRecords: jest.fn((kind, name) => {
				if (kind === "postType" && name === "wp_block") {
					return userPatterns;
				}
				if (kind === "taxonomy" && name === "wp_pattern_category") {
					return userCategories;
				}
				return [];
			}),
		};
		globalThis.window = {
			wp: {
				data: {
					select: jest.fn((storeName) =>
						storeName === "core/block-editor" ? editorStore : coreStore
					),
					resolveSelect: jest.fn(() => coreStore),
				},
				blocks: {
					parse: jest.fn((content) => {
						if (content.includes("cover")) {
							return [{ name: "core/cover", innerBlocks: [{ name: "core/heading" }] }];
						}
						if (content.includes("group")) {
							return [{ name: "core/group", innerBlocks: [{ name: "core/paragraph" }] }];
						}
						return [{ name: "core/paragraph", innerBlocks: [] }];
					}),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("combines registered and user-created patterns with normalized categories", async () => {
		const result = await execute("blu-editor/get-patterns");

		expect(result).toMatchObject({
			count: 4,
			patterns: expect.arrayContaining([
				expect.objectContaining({
					name: "theme/hero",
					title: "Hero",
					source: "theme",
					categories: ["featured", "pages"],
					syncStatus: null,
					blockCount: 2,
					rootBlockNames: ["core/cover"],
				}),
				expect.objectContaining({
					name: "core/block/41",
					title: "Callout",
					source: "user",
					categories: ["marketing"],
					syncStatus: "unsynced",
					blockCount: 2,
					rootBlockNames: ["core/group"],
				}),
				expect.objectContaining({
					name: "core/block/42",
					source: "user",
					syncStatus: "synced",
					blockCount: 1,
					rootBlockNames: ["core/paragraph"],
				}),
			]),
		});
		expect(result.patterns.every((pattern) => pattern.content === undefined)).toBe(true);
	});

	it("filters patterns by category and destination insertability", async () => {
		await expect(
			execute("blu-editor/get-patterns", { category: "marketing" })
		).resolves.toMatchObject({
			count: 1,
			patterns: [{ name: "core/block/41" }],
		});

		await expect(
			execute("blu-editor/get-patterns", {
				rootClientId: "group-1",
			})
		).resolves.toMatchObject({
			count: 3,
			patterns: expect.not.arrayContaining([{ name: "theme/hero" }]),
		});
	});

	it("returns one pattern with optional parsed markup and synced reference metadata", async () => {
		await expect(
			execute("blu-editor/get-pattern", {
				name: "core/block/42",
				includeContent: true,
			})
		).resolves.toMatchObject({
			name: "core/block/42",
			id: 42,
			syncStatus: "synced",
			content: userPatterns[1].content.raw,
			blocks: [{ name: "core/paragraph", innerBlocks: [] }],
		});
	});

	it("lists normalized registered and user pattern categories", async () => {
		await expect(execute("blu-editor/get-pattern-categories")).resolves.toEqual({
			count: 4,
			categories: [
				{
					name: "featured",
					label: "Featured",
					description: "",
					id: null,
					registered: true,
				},
				{
					name: "footer",
					label: "Footers",
					description: "",
					id: null,
					registered: true,
				},
				{
					name: "marketing",
					label: "Marketing",
					description: "",
					id: 7,
					registered: false,
				},
				{
					name: "pages",
					label: "Pages",
					description: "",
					id: null,
					registered: true,
				},
			],
		});
	});

	it("rejects an unresolved pattern name", async () => {
		await expect(execute("blu-editor/get-pattern", { name: "missing/pattern" })).rejects.toThrow(
			"Unknown pattern"
		);
	});
});
