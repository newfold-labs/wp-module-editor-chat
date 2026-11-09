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

describe("editor UI and history abilities", () => {
	let blocks;
	let editor;
	let blockEditorDispatch;
	let editorDispatch;

	beforeAll(async () => {
		await initializeEditorAbilities();
	});

	beforeEach(() => {
		blocks = {
			"paragraph-1": {
				clientId: "paragraph-1",
				name: "core/paragraph",
				attributes: {},
				innerBlocks: [],
			},
		};
		editor = {
			hasEditorUndo: jest.fn().mockReturnValue(true),
			hasEditorRedo: jest.fn().mockReturnValue(true),
		};
		blockEditorDispatch = { selectBlock: jest.fn() };
		editorDispatch = { undo: jest.fn(), redo: jest.fn() };
		globalThis.window = {
			wp: {
				data: {
					select: jest.fn((store) =>
						store === "core/block-editor"
							? { getBlock: jest.fn((id) => blocks[id] || null) }
							: editor
					),
					dispatch: jest.fn((store) =>
						store === "core/block-editor" ? blockEditorDispatch : editorDispatch
					),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("validates selection IDs and reports a non-document mutation", async () => {
		await expect(execute("blu-editor/select-block", { clientId: "stale" })).rejects.toThrow(
			'Unknown clientId "stale"'
		);
		expect(blockEditorDispatch.selectBlock).not.toHaveBeenCalled();

		await expect(
			execute("blu-editor/select-block", { clientId: "paragraph-1" })
		).resolves.toMatchObject({
			changed: false,
			selected: true,
			clientId: "paragraph-1",
		});
		expect(blockEditorDispatch.selectBlock).toHaveBeenCalledWith("paragraph-1");
	});

	it("marks select-block as read-only and non-destructive", () => {
		expect(getDefinition("blu-editor/select-block").meta.annotations).toEqual({
			readonly: true,
			destructive: false,
			idempotent: true,
		});
	});

	it.each([
		["undo", "hasEditorUndo"],
		["redo", "hasEditorRedo"],
	])("rejects unavailable %s without dispatch", async (direction, selector) => {
		editor[selector].mockReturnValue(false);

		await expect(execute(`blu-editor/${direction}`)).rejects.toThrow(new RegExp(direction, "i"));
		expect(editorDispatch[direction]).not.toHaveBeenCalled();
	});

	it.each(["undo", "redo"])("executes available %s history", async (direction) => {
		await expect(execute(`blu-editor/${direction}`)).resolves.toEqual({
			changed: true,
			direction,
		});
		expect(editorDispatch[direction]).toHaveBeenCalledTimes(1);
	});
});
