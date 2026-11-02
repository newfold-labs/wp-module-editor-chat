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

const paragraph = (clientId, content = "") => ({
	clientId,
	name: "core/paragraph",
	attributes: { content },
	innerBlocks: [],
});

describe("block structure abilities", () => {
	let blocks;
	let selectors;
	let dispatch;
	let nextId;
	let orders;
	let roots;

	beforeAll(async () => {
		await initializeEditorAbilities();
	});

	beforeEach(() => {
		nextId = 1;
		blocks = {
			group: { clientId: "group", name: "core/group", attributes: {}, innerBlocks: [] },
			first: paragraph("first", "First"),
			second: paragraph("second", "Second"),
		};
		roots = { group: "", first: "", second: "" };
		orders = { "": ["group", "first", "second"], group: [] };
		selectors = {
			getBlock: jest.fn((id) => blocks[id] || null),
			getBlockRootClientId: jest.fn((id) => roots[id] ?? ""),
			getBlockIndex: jest.fn((id, root = "") => (orders[root] || []).indexOf(id)),
			getBlockOrder: jest.fn((root = "") => [...(orders[root] || [])]),
			getBlockParents: jest.fn((id) => {
				const parents = [];
				let root = roots[id];
				while (root) {
					parents.push(root);
					root = roots[root];
				}
				return parents;
			}),
			canInsertBlockType: jest.fn().mockReturnValue(true),
			canRemoveBlocks: jest.fn().mockReturnValue(true),
			canMoveBlocks: jest.fn().mockReturnValue(true),
		};
		dispatch = {
			insertBlocks: jest.fn((newBlocks, index, root = "") => {
				for (const block of Array.isArray(newBlocks) ? newBlocks : [newBlocks]) {
					blocks[block.clientId] = block;
					roots[block.clientId] = root;
				}
				orders[root].splice(
					index,
					0,
					...(Array.isArray(newBlocks) ? newBlocks : [newBlocks]).map(({ clientId }) => clientId)
				);
			}),
			moveBlocksToPosition: jest.fn((ids, fromRoot, toRoot, index) => {
				orders[fromRoot] = orders[fromRoot].filter((id) => !ids.includes(id));
				orders[toRoot].splice(index, 0, ...ids);
				ids.forEach((id) => {
					roots[id] = toRoot;
				});
			}),
			removeBlocks: jest.fn((ids) => {
				for (const id of ids) {
					orders[roots[id]] = orders[roots[id]].filter((item) => item !== id);
					delete blocks[id];
				}
			}),
			replaceBlocks: jest.fn((ids, replacements) => {
				const root = roots[ids[0]];
				const index = orders[root].indexOf(ids[0]);
				orders[root].splice(index, ids.length, ...replacements.map(({ clientId }) => clientId));
				ids.forEach((id) => delete blocks[id]);
				replacements.forEach((block) => {
					blocks[block.clientId] = block;
					roots[block.clientId] = root;
				});
			}),
		};
		globalThis.window = {
			wp: {
				data: {
					select: jest.fn((store) =>
						store === "core/block-editor"
							? selectors
							: { getBlockType: jest.fn((name) => ({ name, attributes: {} })) }
					),
					dispatch: jest.fn(() => dispatch),
				},
				blocks: {
					createBlock: jest.fn((name, attributes, innerBlocks = []) => ({
						clientId: `new-${nextId++}`,
						name,
						attributes: attributes || {},
						innerBlocks,
					})),
					switchToBlockType: jest.fn((block, name) => [
						{ ...block, clientId: `transformed-${nextId++}`, name },
					]),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("inserts nested blocks and resolves sibling placement", async () => {
		const result = await execute("blu-editor/insert-block", {
			name: "core/group",
			afterClientId: "first",
			innerBlocks: [{ name: "core/paragraph", attributes: { content: "Nested" } }],
		});
		expect(dispatch.insertBlocks).toHaveBeenCalledWith(expect.any(Array), 2, "");
		expect(result).toMatchObject({ changed: true, rootClientId: "", index: 2 });
		expect(result.clientIds).toHaveLength(1);
	});

	it("validates stale sibling IDs before dispatch", async () => {
		await expect(
			execute("blu-editor/insert-block", {
				name: "core/paragraph",
				afterClientId: "stale",
			})
		).rejects.toThrow('Unknown afterClientId "stale"');
		expect(dispatch.insertBlocks).not.toHaveBeenCalled();
	});

	it("rejects an anchored root insert instead of retargeting it to post content", async () => {
		blocks.post = {
			clientId: "post",
			name: "core/post-content",
			attributes: {},
			innerBlocks: [],
		};
		roots.post = "";
		orders.post = [];
		selectors.getBlocksByName = jest.fn().mockReturnValue(["post"]);
		selectors.canInsertBlockType.mockImplementation((_name, root) => root === "post");

		await expect(
			execute("blu-editor/insert-block", {
				name: "core/paragraph",
				afterClientId: "first",
			})
		).rejects.toThrow(/afterClientId|requested sibling/i);
		expect(dispatch.insertBlocks).not.toHaveBeenCalled();
	});

	it("rejects empty supplied sibling IDs before dispatch", async () => {
		await expect(
			execute("blu-editor/insert-block", {
				name: "core/paragraph",
				afterClientId: "",
			})
		).rejects.toThrow('Unknown afterClientId ""');
		await expect(
			execute("blu-editor/move-block", {
				clientId: "first",
				beforeClientId: "",
			})
		).rejects.toThrow('Unknown beforeClientId ""');
		expect(dispatch.insertBlocks).not.toHaveBeenCalled();
		expect(dispatch.moveBlocksToPosition).not.toHaveBeenCalled();
	});

	it("validates destination roots and nesting before dispatch", async () => {
		await expect(
			execute("blu-editor/insert-block", {
				name: "core/paragraph",
				rootClientId: "stale",
			})
		).rejects.toThrow('Unknown rootClientId "stale"');
		selectors.canInsertBlockType.mockReturnValue(false);
		await expect(
			execute("blu-editor/insert-block", {
				name: "core/paragraph",
				rootClientId: "group",
			})
		).rejects.toThrow(/cannot be inserted/i);
		expect(dispatch.insertBlocks).not.toHaveBeenCalled();
	});

	it("retargets a refused document-root insert to post content", async () => {
		blocks.post = {
			clientId: "post",
			name: "core/post-content",
			attributes: {},
			innerBlocks: [],
		};
		roots.post = "";
		orders.post = [];
		selectors.getBlocksByName = jest.fn().mockReturnValue(["post"]);
		selectors.canInsertBlockType.mockImplementation((_name, root) => root === "post");

		const result = await execute("blu-editor/insert-block", { name: "core/paragraph" });

		expect(dispatch.insertBlocks).toHaveBeenCalledWith(expect.any(Array), 0, "post");
		expect(result).toMatchObject({ changed: true, rootClientId: "post", index: 0 });
	});

	it("recursively validates child nesting before dispatch", async () => {
		window.wp.data.select.mockImplementation((store) =>
			store === "core/block-editor"
				? selectors
				: {
						getBlockType: jest.fn((name) => ({
							name,
							attributes: {},
							...(name === "core/group" ? { allowedBlocks: ["core/column"] } : {}),
						})),
					}
		);

		await expect(
			execute("blu-editor/insert-block", {
				name: "core/group",
				innerBlocks: [{ name: "core/paragraph" }],
			})
		).rejects.toThrow(/does not allow/);
		expect(dispatch.insertBlocks).not.toHaveBeenCalled();
	});

	it("validates registered ancestor constraints for nested trees and destinations", async () => {
		window.wp.data.select.mockImplementation((store) =>
			store === "core/block-editor"
				? selectors
				: {
						getBlockType: jest.fn((name) => ({
							name,
							attributes: {},
							...(name === "core/paragraph" ? { ancestor: ["core/section"] } : {}),
						})),
					}
		);

		await expect(
			execute("blu-editor/insert-block", {
				name: "core/group",
				innerBlocks: [{ name: "core/paragraph" }],
			})
		).rejects.toThrow(/ancestor|core\/section/i);
		await expect(
			execute("blu-editor/insert-block", {
				name: "core/paragraph",
				rootClientId: "group",
			})
		).rejects.toThrow(/ancestor|core\/section/i);
		expect(dispatch.insertBlocks).not.toHaveBeenCalled();
	});

	it("prevents moving a block into itself or a descendant", async () => {
		blocks.child = paragraph("child");
		blocks.group.innerBlocks = [blocks.child];
		selectors.getBlockRootClientId.mockImplementation((id) => (id === "child" ? "group" : ""));
		selectors.getBlockParents.mockImplementation((id) => (id === "child" ? ["group"] : []));
		await expect(
			execute("blu-editor/move-block", { clientId: "group", rootClientId: "group" })
		).rejects.toThrow(/itself/i);
		await expect(
			execute("blu-editor/move-block", { clientId: "group", rootClientId: "child" })
		).rejects.toThrow(/descendant/i);
		expect(dispatch.moveBlocksToPosition).not.toHaveBeenCalled();
	});

	it("respects move and remove locks", async () => {
		selectors.canMoveBlocks.mockReturnValue(false);
		await expect(
			execute("blu-editor/move-block", { clientId: "first", rootClientId: "group" })
		).rejects.toThrow(/locked|move/i);
		selectors.canRemoveBlocks.mockReturnValue(false);
		await expect(execute("blu-editor/remove-block", { clientId: "first" })).rejects.toThrow(
			/locked|remove/i
		);
		expect(dispatch.moveBlocksToPosition).not.toHaveBeenCalled();
		expect(dispatch.removeBlocks).not.toHaveBeenCalled();
	});

	it("only exposes typed fallback metadata for a special entity before dispatch", async () => {
		blocks.first = {
			...blocks.first,
			name: "core/navigation",
			attributes: { ref: 42 },
		};
		let error;
		try {
			await execute("blu-editor/remove-block", { clientId: "first" });
		} catch (caught) {
			error = caught;
		}
		expect(error).toMatchObject({
			name: "EditorAbilityUnsupportedError",
			mutated: false,
			fallbackTool: "blu-delete-block",
			fallbackArguments: { client_id: "first" },
		});
		expect(dispatch.removeBlocks).not.toHaveBeenCalled();
	});

	it("removes a block and reports actual changed state", async () => {
		await expect(execute("blu-editor/remove-block", { clientId: "first" })).resolves.toMatchObject({
			clientId: "first",
			changed: true,
			rootClientId: "",
			index: 1,
		});
		expect(selectors.getBlock).toHaveBeenCalledWith("first");
	});

	it("transforms one block into one or many replacement blocks", async () => {
		window.wp.blocks.switchToBlockType.mockReturnValue([
			paragraph("replacement-1"),
			paragraph("replacement-2"),
		]);
		const result = await execute("blu-editor/transform-block", {
			clientId: "first",
			name: "core/columns",
		});
		expect(dispatch.replaceBlocks).toHaveBeenCalledWith(
			["first"],
			expect.arrayContaining([
				expect.objectContaining({ clientId: "replacement-1" }),
				expect.objectContaining({ clientId: "replacement-2" }),
			])
		);
		expect(result).toMatchObject({
			changed: true,
			clientIds: ["replacement-1", "replacement-2"],
			rootClientId: "",
			indexes: [1, 2],
		});
	});

	it("transforms one block into a single replacement", async () => {
		window.wp.blocks.switchToBlockType.mockReturnValue([
			{ ...paragraph("replacement"), name: "core/heading" },
		]);

		await expect(
			execute("blu-editor/transform-block", {
				clientId: "first",
				name: "core/heading",
			})
		).resolves.toMatchObject({
			changed: true,
			clientIds: ["replacement"],
			count: 1,
			rootClientId: "",
			indexes: [1],
		});
		expect(dispatch.replaceBlocks).toHaveBeenCalledWith(
			["first"],
			[expect.objectContaining({ clientId: "replacement", name: "core/heading" })]
		);
	});

	it("rejects a source-locked transform before replacement", async () => {
		selectors.canRemoveBlocks.mockReturnValue(false);

		await expect(
			execute("blu-editor/transform-block", {
				clientId: "first",
				name: "core/heading",
			})
		).rejects.toThrow(/locked|replace|transform/i);
		expect(dispatch.replaceBlocks).not.toHaveBeenCalled();
	});

	it("does not expose fallback metadata after a refused dispatch", async () => {
		dispatch.moveBlocksToPosition.mockImplementation(() => {});
		let error;
		try {
			await execute("blu-editor/move-block", {
				clientId: "first",
				rootClientId: "group",
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect(error).toHaveProperty("mutated", true);
		expect(error).not.toHaveProperty("fallbackTool");
		expect(error).not.toHaveProperty("fallbackArguments");
	});
});
