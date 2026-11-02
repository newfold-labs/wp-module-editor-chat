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

describe("pattern write abilities", () => {
	let blocks;
	let orders;
	let roots;
	let editor;
	let editorDispatch;
	let core;
	let coreDispatch;
	let nextId;

	beforeAll(async () => {
		await initializeEditorAbilities();
	});

	beforeEach(() => {
		nextId = 1;
		blocks = {
			first: paragraph("first", "First"),
			second: paragraph("second", "Second"),
			group: { clientId: "group", name: "core/group", attributes: {}, innerBlocks: [] },
		};
		orders = { "": ["first", "second", "group"], group: [] };
		roots = { first: "", second: "", group: "" };
		editor = {
			getBlock: jest.fn((id) => blocks[id] || null),
			getBlockRootClientId: jest.fn((id) => roots[id] ?? ""),
			getBlockIndex: jest.fn((id, root = "") => (orders[root] || []).indexOf(id)),
			getBlockOrder: jest.fn((root = "") => [...(orders[root] || [])]),
			getBlockParents: jest.fn().mockReturnValue([]),
			canInsertBlockType: jest.fn().mockReturnValue(true),
			canRemoveBlocks: jest.fn().mockReturnValue(true),
		};
		editorDispatch = {
			insertBlocks: jest.fn((newBlocks, index, root = "") => {
				newBlocks.forEach((block) => {
					blocks[block.clientId] = block;
					roots[block.clientId] = root;
				});
				orders[root].splice(index, 0, ...newBlocks.map(({ clientId }) => clientId));
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
			removeBlocks: jest.fn(),
		};
		core = {
			getBlockPatterns: jest.fn().mockReturnValue([
				{
					name: "theme/callout",
					title: "Callout",
					content: "<!-- wp:paragraph --><p>Callout</p><!-- /wp:paragraph -->",
				},
			]),
			getEntityRecords: jest.fn((kind, name) => {
				if (kind === "postType" && name === "wp_block") {
					return [
						{
							id: 41,
							title: { raw: "Synced" },
							content: { raw: "<!-- wp:paragraph --><p>Synced</p><!-- /wp:paragraph -->" },
							meta: {},
							wp_pattern_category: [],
						},
						{
							id: 42,
							title: { raw: "Unsynced" },
							content: { raw: "<!-- wp:paragraph --><p>Unsynced</p><!-- /wp:paragraph -->" },
							meta: { wp_pattern_sync_status: "unsynced" },
							wp_pattern_category: [],
						},
					];
				}
				if (kind === "taxonomy" && name === "wp_pattern_category") {
					return [{ id: 7, slug: "existing", name: "Existing" }];
				}
				return [];
			}),
			getCurrentUser: jest.fn().mockReturnValue({ capabilities: { edit_posts: true } }),
			canUser: jest.fn().mockReturnValue(true),
		};
		coreDispatch = {
			saveEntityRecord: jest.fn((kind, name, record) => {
				if (kind === "taxonomy") {
					return { id: 8, slug: record.slug, name: record.name };
				}
				return { id: 99, ...record };
			}),
		};
		globalThis.window = {
			wp: {
				data: {
					select: jest.fn((store) => (store === "core/block-editor" ? editor : core)),
					resolveSelect: jest.fn(() => core),
					dispatch: jest.fn((store) =>
						store === "core/block-editor" ? editorDispatch : coreDispatch
					),
				},
				blocks: {
					parse: jest.fn((content) => [
						paragraph(`parsed-${nextId++}`, content.includes("Unsynced") ? "Unsynced" : "Pattern"),
					]),
					createBlock: jest.fn((name, attributes = {}, innerBlocks = []) => ({
						clientId: `new-${nextId++}`,
						name,
						attributes,
						innerBlocks,
					})),
					serialize: jest.fn(
						(source) => `serialized:${source.map(({ clientId }) => clientId).join(",")}`
					),
					getBlockType: jest.fn((name) => ({ name, attributes: {} })),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("inserts registered and unsynced patterns as validated ordinary blocks", async () => {
		await expect(
			execute("blu-editor/insert-pattern", { name: "theme/callout" })
		).resolves.toMatchObject({ changed: true, patternName: "theme/callout", count: 1 });
		await expect(
			execute("blu-editor/insert-pattern", { name: "core/block/42" })
		).resolves.toMatchObject({ changed: true, patternName: "core/block/42", count: 1 });
		expect(editorDispatch.insertBlocks).toHaveBeenCalledTimes(2);
	});

	it("preserves synced references unless explicitly expanded", async () => {
		const result = await execute("blu-editor/insert-pattern", { name: "core/block/41" });
		expect(editorDispatch.insertBlocks).toHaveBeenLastCalledWith(
			[expect.objectContaining({ name: "core/block", attributes: { ref: 41 } })],
			3,
			""
		);
		expect(result).toMatchObject({ changed: true, asReference: true, patternId: 41 });

		await execute("blu-editor/insert-pattern", {
			name: "core/block/41",
			asReference: false,
		});
		expect(editorDispatch.insertBlocks).toHaveBeenLastCalledWith(
			[expect.objectContaining({ name: "core/paragraph" })],
			4,
			""
		);
	});

	it("supports forcing a user pattern reference and rejects registered references", async () => {
		await execute("blu-editor/insert-pattern", {
			name: "core/block/42",
			asReference: true,
		});
		expect(editorDispatch.insertBlocks).toHaveBeenCalledWith(
			[expect.objectContaining({ name: "core/block", attributes: { ref: 42 } })],
			3,
			""
		);
		await expect(
			execute("blu-editor/insert-pattern", {
				name: "theme/callout",
				asReference: true,
			})
		).rejects.toThrow(/reference|user pattern/i);
	});

	it("validates destinations and every top-level block before insertion", async () => {
		await expect(
			execute("blu-editor/insert-pattern", {
				name: "theme/callout",
				rootClientId: "stale",
			})
		).rejects.toThrow('Unknown rootClientId "stale"');
		editor.canInsertBlockType.mockReturnValue(false);
		await expect(
			execute("blu-editor/insert-pattern", {
				name: "theme/callout",
				rootClientId: "group",
			})
		).rejects.toThrow(/cannot be inserted/i);
		expect(editorDispatch.insertBlocks).not.toHaveBeenCalled();
	});

	it("rejects the whole pattern when any top-level block is disallowed", async () => {
		window.wp.blocks.parse.mockReturnValue([
			paragraph("parsed-paragraph"),
			{
				clientId: "parsed-heading",
				name: "core/heading",
				attributes: {},
				innerBlocks: [],
			},
		]);
		editor.canInsertBlockType.mockImplementation((name) => name !== "core/heading");

		await expect(
			execute("blu-editor/insert-pattern", {
				name: "theme/callout",
				rootClientId: "group",
			})
		).rejects.toThrow(/core\/heading.*cannot be inserted/i);
		expect(editorDispatch.insertBlocks).not.toHaveBeenCalled();
	});

	it("creates a pattern from validated client IDs and existing/new categories", async () => {
		const result = await execute("blu-editor/create-pattern", {
			title: "Saved pair",
			clientIds: ["first", "second"],
			categories: ["existing", "new-category"],
			syncStatus: "unsynced",
		});
		expect(coreDispatch.saveEntityRecord).toHaveBeenCalledWith(
			"taxonomy",
			"wp_pattern_category",
			expect.objectContaining({ slug: "new-category" }),
			{ throwOnError: true }
		);
		expect(coreDispatch.saveEntityRecord).toHaveBeenLastCalledWith(
			"postType",
			"wp_block",
			expect.objectContaining({
				title: "Saved pair",
				content: "serialized:first,second",
				wp_pattern_category: [7, 8],
				meta: { wp_pattern_sync_status: "unsynced" },
			}),
			{ throwOnError: true }
		);
		expect(result).toMatchObject({ changed: true, id: 99, syncStatus: "unsynced" });
	});

	it("creates a synced pattern from supplied validated blocks", async () => {
		await execute("blu-editor/create-pattern", {
			title: "Supplied",
			blocks: [{ name: "core/paragraph", attributes: { content: "Supplied" } }],
			syncStatus: "synced",
		});
		expect(coreDispatch.saveEntityRecord).toHaveBeenLastCalledWith(
			"postType",
			"wp_block",
			expect.objectContaining({
				meta: undefined,
			}),
			{ throwOnError: true }
		);
	});

	it("validates all source and adjacency IDs before the first write", async () => {
		await expect(
			execute("blu-editor/create-pattern", {
				title: "Invalid",
				clientIds: ["first", "stale"],
				replaceSource: true,
				syncStatus: "synced",
			})
		).rejects.toThrow(/Unknown clientId/);
		expect(coreDispatch.saveEntityRecord).not.toHaveBeenCalled();
		expect(editorDispatch.replaceBlocks).not.toHaveBeenCalled();
	});

	it("can replace adjacent source blocks with the new synced reference", async () => {
		await execute("blu-editor/create-pattern", {
			title: "Replace pair",
			clientIds: ["first", "second"],
			replaceSource: true,
			syncStatus: "synced",
		});
		expect(editorDispatch.replaceBlocks).toHaveBeenCalledWith(
			["first", "second"],
			[expect.objectContaining({ name: "core/block", attributes: { ref: 99 } })]
		);
	});

	it("rejects non-adjacent replacement and insufficient current-user permissions", async () => {
		orders[""] = ["first", "group", "second"];
		await expect(
			execute("blu-editor/create-pattern", {
				title: "Not adjacent",
				clientIds: ["first", "second"],
				replaceSource: true,
				syncStatus: "synced",
			})
		).rejects.toThrow(/adjacent|contiguous/i);
		orders[""] = ["first", "second", "group"];
		core.canUser.mockReturnValue(false);
		await expect(
			execute("blu-editor/create-pattern", {
				title: "Forbidden",
				clientIds: ["first"],
			})
		).rejects.toThrow(/permission|allowed/i);
		expect(coreDispatch.saveEntityRecord).not.toHaveBeenCalled();
	});
});
