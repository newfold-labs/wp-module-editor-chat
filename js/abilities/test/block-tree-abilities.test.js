/* global afterEach, beforeAll, beforeEach, describe, expect, it, jest */

/**
 * External dependencies
 */
import { registerAbility } from "@wordpress/abilities";

/**
 * Internal dependencies
 */
import { initializeEditorAbilities } from "../index";

let definition;

const executeTree = (input = {}) => definition.callback(input);

describe("get-editor-tree ability", () => {
	beforeAll(async () => {
		await initializeEditorAbilities();
		definition = registerAbility.mock.calls.find(
			([ability]) => ability.name === "blu-editor/get-editor-tree"
		)[0];
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

		await expect(executeTree()).resolves.toEqual({
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

		const result = await executeTree({ maxDepth: 0 });

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

		const result = await executeTree({ maxDepth: 5 });

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
});
