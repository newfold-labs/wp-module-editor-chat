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

const blockTypes = [
	{
		name: "core/image",
		title: "Image",
		description: "Insert an image.",
		category: "media",
		icon: "format-image",
		keywords: ["photo"],
		attributes: {
			id: { type: "number" },
			url: { type: "string", source: "attribute", selector: "img", attribute: "src" },
		},
		supports: { align: true },
		styles: [{ name: "rounded", label: "Rounded", isDefault: true }],
		variations: [
			{ name: "featured", title: "Featured image", attributes: { className: "featured" } },
		],
	},
	{
		name: "core/paragraph",
		title: "Paragraph",
		description: "Start with text.",
		category: "text",
		icon: "editor-paragraph",
		keywords: ["text"],
		attributes: { content: { type: "string", source: "rich-text" } },
		supports: { inserter: true },
		styles: [],
		variations: [],
	},
	{
		name: "plugin/hidden",
		title: "Hidden",
		description: "Not shown in the inserter.",
		category: "widgets",
		attributes: {},
		supports: { inserter: false },
	},
];

describe("block catalogue abilities", () => {
	beforeAll(async () => {
		await initializeEditorAbilities();
	});

	beforeEach(() => {
		const blockRegistry = {
			getBlockTypes: jest.fn().mockReturnValue(blockTypes),
			getBlockType: jest.fn((name) => blockTypes.find((type) => type.name === name)),
			getBlockStyles: jest.fn((name) => (name === "core/image" ? blockTypes[0].styles : [])),
			getBlockVariations: jest.fn((name) =>
				name === "core/image" ? blockTypes[0].variations : []
			),
		};
		const editorStore = {
			getBlock: jest.fn((clientId) =>
				clientId === "group-1" ? { clientId, name: "core/group" } : null
			),
			canInsertBlockType: jest.fn((name) => name === "core/image"),
		};
		globalThis.window = {
			wp: {
				data: {
					select: jest.fn((storeName) =>
						storeName === "core/blocks" ? blockRegistry : editorStore
					),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("searches and filters a compact block type list", async () => {
		await expect(execute("blu-editor/get-block-types", { search: "image" })).resolves.toEqual({
			count: 1,
			totalCount: 3,
			blockTypes: [
				{
					name: "core/image",
					title: "Image",
					description: "Insert an image.",
					category: "media",
				},
			],
		});

		await expect(
			execute("blu-editor/get-block-types", { category: "text" })
		).resolves.toMatchObject({
			count: 1,
			blockTypes: [{ name: "core/paragraph", category: "text" }],
		});
	});

	it("hides non-inserter block types unless requested", async () => {
		await expect(execute("blu-editor/get-block-types")).resolves.toMatchObject({ count: 2 });
		await expect(
			execute("blu-editor/get-block-types", { includeHidden: true })
		).resolves.toMatchObject({
			count: 3,
			blockTypes: expect.arrayContaining([expect.objectContaining({ name: "plugin/hidden" })]),
		});
	});

	it("filters block types by destination insertability after validating the root", async () => {
		await expect(
			execute("blu-editor/get-block-types", {
				rootClientId: "group-1",
			})
		).resolves.toMatchObject({
			count: 1,
			blockTypes: [{ name: "core/image" }],
		});

		await expect(
			execute("blu-editor/get-block-types", {
				rootClientId: "missing",
			})
		).rejects.toThrow('Unknown rootClientId "missing"');
	});

	it("returns the complete registered schema only from get-block-type", async () => {
		const result = await execute("blu-editor/get-block-type", { name: "core/image" });

		expect(result).toEqual({
			name: "core/image",
			title: "Image",
			description: "Insert an image.",
			category: "media",
			keywords: ["photo"],
			attributes: blockTypes[0].attributes,
			supports: { align: true },
			parent: null,
			ancestor: null,
			allowedBlocks: null,
			styles: [
				{
					name: "rounded",
					label: "Rounded",
					isDefault: true,
					className: "is-style-rounded",
				},
			],
			variations: [
				{
					name: "featured",
					title: "Featured image",
					description: "",
					isDefault: false,
					attributes: { className: "featured" },
					innerBlocks: [],
				},
			],
		});
		expect((await execute("blu-editor/get-block-types")).blockTypes[0].attributes).toBeUndefined();
	});

	it("rejects an unknown block type", async () => {
		await expect(execute("blu-editor/get-block-type", { name: "missing/type" })).rejects.toThrow(
			"Unknown block type"
		);
	});
});
