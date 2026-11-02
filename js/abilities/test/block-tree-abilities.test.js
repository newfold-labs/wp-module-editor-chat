/* global afterEach, beforeAll, beforeEach, describe, expect, it, jest */

/**
 * External dependencies
 */
import { registerAbility } from "@wordpress/abilities";

/**
 * Internal dependencies
 */
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

describe("block-tree abilities", () => {
	beforeAll(async () => {
		await initializeEditorAbilities();
	});

	beforeEach(() => {
		globalThis.window = {
			wp: {
				data: {
					select: jest.fn(),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("returns an empty editor tree", async () => {
		window.wp.data.select.mockReturnValue({
			getBlocks: jest.fn().mockReturnValue([]),
			getBlock: jest.fn(),
			getBlockOrder: jest.fn().mockReturnValue([]),
			getBlockRootClientId: jest.fn(),
		});

		await expect(execute("blu-editor/get-editor-tree")).resolves.toEqual({
			blocks: [],
			count: 0,
		});
	});

	it("limits nested traversal by depth", async () => {
		const child = {
			clientId: "child",
			name: "core/paragraph",
			attributes: { content: "Nested" },
			innerBlocks: [],
		};
		const root = {
			clientId: "root",
			name: "core/group",
			attributes: {},
			innerBlocks: [child],
		};
		window.wp.data.select.mockReturnValue({
			getBlocks: jest.fn().mockReturnValue([root]),
			getBlock: jest.fn((clientId) => (clientId === "root" ? root : child)),
			getBlockOrder: jest.fn().mockReturnValue([]),
			getBlockRootClientId: jest.fn(),
		});

		const result = await execute("blu-editor/get-editor-tree", { maxDepth: 0 });

		expect(result.blocks[0]).toMatchObject({
			clientId: "root",
			name: "core/group",
			innerBlocks: [],
			truncatedInnerBlockCount: 1,
		});
	});

	it("guards controlled inner-block recursion", async () => {
		const pattern = {
			clientId: "pattern",
			name: "core/block",
			attributes: { ref: 42 },
			innerBlocks: [],
		};
		const selectors = {
			getBlocks: jest.fn().mockReturnValue([pattern]),
			getBlock: jest.fn().mockReturnValue(pattern),
			getBlockOrder: jest.fn().mockReturnValue(["pattern"]),
			getBlockRootClientId: jest.fn().mockReturnValue("pattern"),
			areInnerBlocksControlled: jest.fn().mockReturnValue(true),
		};
		window.wp.data.select.mockReturnValue(selectors);

		const result = await execute("blu-editor/get-editor-tree", { maxDepth: 5 });

		expect(result.blocks[0]).toMatchObject({
			clientId: "pattern",
			controlledInnerBlocks: true,
			innerBlocks: [
				{
					clientId: "pattern",
					controlledInnerBlocks: true,
					innerBlocks: [],
					truncatedInnerBlockCount: 1,
				},
			],
		});
	});

	it("finds nested blocks by text and respects maxDepth", async () => {
		const paragraph = {
			clientId: "paragraph-1",
			name: "core/paragraph",
			attributes: { content: "Hello Chloe" },
			innerBlocks: [],
		};
		const group = {
			clientId: "group-1",
			name: "core/group",
			attributes: { className: "team" },
			innerBlocks: [paragraph],
		};
		window.wp.data.select.mockReturnValue({
			getBlocks: jest.fn().mockReturnValue([group]),
			areInnerBlocksControlled: jest.fn().mockReturnValue(false),
		});

		await expect(
			execute("blu-editor/find-editor-blocks", { search: "Chloe" })
		).resolves.toMatchObject({
			count: 1,
			blocks: [{ clientId: "paragraph-1", name: "core/paragraph" }],
		});
		await expect(
			execute("blu-editor/find-editor-blocks", { search: "Chloe", maxDepth: 0 })
		).resolves.toEqual({ blocks: [], count: 0 });
	});

	it("searches controlled inner blocks and truncates recursive patterns", async () => {
		const paragraph = {
			clientId: "controlled-paragraph",
			name: "core/paragraph",
			attributes: { content: "Chloe" },
			innerBlocks: [],
		};
		const pattern = {
			clientId: "pattern-1",
			name: "core/block",
			attributes: { ref: 42 },
			innerBlocks: [],
		};
		const recursivePattern = {
			clientId: "pattern-2",
			name: "core/block",
			attributes: { ref: 42 },
			innerBlocks: [],
		};
		const selectors = {
			getBlocks: jest.fn((clientId) => {
				if (clientId === "pattern-1") {
					return [paragraph, recursivePattern];
				}
				if (clientId === "pattern-2") {
					return [recursivePattern];
				}
				return [pattern];
			}),
			areInnerBlocksControlled: jest.fn((clientId) => clientId.startsWith("pattern-")),
		};
		window.wp.data.select.mockReturnValue(selectors);

		const result = await execute("blu-editor/find-editor-blocks", { search: "Chloe" });

		expect(result).toMatchObject({
			count: 1,
			blocks: [{ clientId: "controlled-paragraph", name: "core/paragraph" }],
		});
		expect(selectors.getBlocks).toHaveBeenCalledTimes(3);
	});

	it("rejects unknown location and root IDs before root selectors run", async () => {
		const selectors = {
			getBlock: jest.fn().mockReturnValue(null),
			getBlockRootClientId: jest.fn(),
			getBlockIndex: jest.fn(),
			getBlocks: jest.fn(),
		};
		window.wp.data.select.mockReturnValue(selectors);

		await expect(execute("blu-editor/get-block-location", { clientId: "missing" })).rejects.toThrow(
			'Unknown clientId "missing"'
		);
		await expect(
			execute("blu-editor/find-editor-blocks", { rootClientId: "missing" })
		).rejects.toThrow('Unknown rootClientId "missing"');
		expect(selectors.getBlockRootClientId).not.toHaveBeenCalled();
		expect(selectors.getBlocks).not.toHaveBeenCalled();
	});

	it("returns a block location with its parent path", async () => {
		const block = {
			clientId: "paragraph-1",
			name: "core/paragraph",
			attributes: {},
			innerBlocks: [],
		};
		const group = {
			clientId: "group-1",
			name: "core/group",
			attributes: {},
			innerBlocks: [block],
		};
		window.wp.data.select.mockReturnValue({
			getBlock: jest.fn((clientId) => (clientId === "group-1" ? group : block)),
			getBlockRootClientId: jest.fn().mockReturnValue("group-1"),
			getBlockIndex: jest.fn((clientId) => (clientId === "group-1" ? 0 : 1)),
			getBlockParents: jest.fn().mockReturnValue(["group-1"]),
		});

		await expect(
			execute("blu-editor/get-block-location", { clientId: "paragraph-1" })
		).resolves.toMatchObject({
			clientId: "paragraph-1",
			name: "core/paragraph",
			rootClientId: "group-1",
			index: 1,
			parentClientIds: ["group-1"],
			path: [
				{ clientId: "group-1", name: "core/group", index: 0 },
				{ clientId: "paragraph-1", name: "core/paragraph", index: 1 },
			],
		});
	});

	it("returns the current selection", async () => {
		window.wp.data.select.mockReturnValue({
			getSelectedBlockClientId: jest.fn().mockReturnValue("paragraph-1"),
			getSelectedBlockClientIds: jest.fn().mockReturnValue(["paragraph-1"]),
			getSelectionStart: jest
				.fn()
				.mockReturnValue({ clientId: "paragraph-1", attributeKey: "content", offset: 2 }),
			getSelectionEnd: jest
				.fn()
				.mockReturnValue({ clientId: "paragraph-1", attributeKey: "content", offset: 5 }),
			getBlock: jest.fn().mockReturnValue({
				clientId: "paragraph-1",
				name: "core/paragraph",
				attributes: { content: "Chloe" },
				innerBlocks: [],
			}),
		});

		await expect(execute("blu-editor/get-editor-selection")).resolves.toMatchObject({
			selectedBlockClientId: "paragraph-1",
			selectedBlockClientIds: ["paragraph-1"],
			selectedBlock: { clientId: "paragraph-1", name: "core/paragraph" },
		});
	});

	it("checks insertion support and validates a supplied root", async () => {
		const group = {
			clientId: "group-1",
			name: "core/group",
			attributes: {},
			innerBlocks: [],
		};
		const selectors = {
			getBlock: jest.fn((clientId) => (clientId === "group-1" ? group : null)),
			canInsertBlockType: jest.fn().mockReturnValue(true),
		};
		window.wp.data.select.mockReturnValue(selectors);

		await expect(
			execute("blu-editor/can-insert-block", {
				name: "core/paragraph",
				rootClientId: "group-1",
			})
		).resolves.toEqual({
			name: "core/paragraph",
			rootClientId: "group-1",
			canInsert: true,
		});
		expect(selectors.canInsertBlockType).toHaveBeenCalledWith("core/paragraph", "group-1");

		await expect(
			execute("blu-editor/can-insert-block", {
				name: "core/paragraph",
				rootClientId: "missing",
			})
		).rejects.toThrow('Unknown rootClientId "missing"');
		expect(selectors.canInsertBlockType).toHaveBeenCalledTimes(1);
	});
});
