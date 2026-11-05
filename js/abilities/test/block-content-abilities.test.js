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

describe("block content abilities", () => {
	let blocks;
	let roots;
	let selectors;
	let dispatch;
	let selectedBlockId;

	beforeAll(async () => {
		await initializeEditorAbilities();
	});

	beforeEach(() => {
		const button = {
			clientId: "button-1",
			name: "core/button",
			attributes: { content: "Buy", backgroundColor: "contrast" },
			innerBlocks: [],
		};
		const secondButton = {
			clientId: "button-2",
			name: "core/button",
			attributes: { content: "Learn", backgroundColor: "contrast" },
			innerBlocks: [],
		};
		selectedBlockId = null;
		blocks = {
			"paragraph-1": {
				clientId: "paragraph-1",
				name: "core/paragraph",
				attributes: {
					content: "Old",
					style: { color: { text: "#111" }, spacing: { margin: ["1px"] } },
				},
				innerBlocks: [],
			},
			"image-1": {
				clientId: "image-1",
				name: "core/image",
				attributes: { url: "https://example.com/old.jpg", alt: "Old" },
				innerBlocks: [],
			},
			"button-1": button,
			"button-2": secondButton,
			"buttons-1": {
				clientId: "buttons-1",
				name: "core/buttons",
				attributes: { layout: { type: "flex" } },
				innerBlocks: [button, secondButton],
			},
		};
		roots = {
			"paragraph-1": "",
			"image-1": "",
			"buttons-1": "",
			"button-1": "buttons-1",
			"button-2": "buttons-1",
		};
		selectors = {
			getBlock: jest.fn((id) => blocks[id] || null),
			getSelectedBlockClientId: jest.fn(() => selectedBlockId),
			getBlockRootClientId: jest.fn((id) => roots[id] || ""),
			getBlockParents: jest.fn((id) => {
				const result = [];
				let root = roots[id];
				while (root) {
					result.push(root);
					root = roots[root];
				}
				return result;
			}),
			canRemoveBlocks: jest.fn().mockReturnValue(true),
			canEditBlock: jest.fn().mockReturnValue(true),
			getBlockEditingMode: jest.fn().mockReturnValue("default"),
		};
		dispatch = {
			replaceBlock: jest.fn((clientId, replacement) => {
				delete blocks[clientId];
				blocks[replacement.clientId] = replacement;
				roots[replacement.clientId] = roots[clientId] || "";
			}),
			updateBlockAttributes: jest.fn((clientId, attributes) => {
				blocks[clientId] = { ...blocks[clientId], attributes };
			}),
		};
		const blockTypes = {
			"core/paragraph": {
				name: "core/paragraph",
				attributes: {
					content: { type: "string" },
					style: { type: "object" },
					textColor: { type: "string" },
				},
			},
			"core/image": {
				name: "core/image",
				attributes: {
					url: { type: "string" },
					alt: { type: "string" },
					id: { type: "integer" },
				},
			},
			"core/button": {
				name: "core/button",
				attributes: {
					content: { type: "string" },
					className: { type: "string" },
					style: { type: "object" },
					textColor: { type: "string" },
					backgroundColor: { type: "string" },
				},
			},
			"core/buttons": {
				name: "core/buttons",
				attributes: {
					layout: { type: "object" },
					style: { type: "object" },
				},
			},
		};
		globalThis.window = {
			wp: {
				data: {
					select: jest.fn((store) =>
						store === "core/block-editor"
							? selectors
							: {
									getBlockType: jest.fn((name) => blockTypes[name] || null),
								}
					),
					dispatch: jest.fn(() => dispatch),
				},
				blocks: {
					parse: jest.fn(() => [
						{
							clientId: "replacement-1",
							name: "core/paragraph",
							attributes: { content: "Updated" },
							innerBlocks: [],
						},
					]),
				},
			},
		};
	});

	afterEach(() => {
		delete globalThis.window;
	});

	it("parses complete markup and directly replaces one target block", async () => {
		const markup = "<!-- wp:paragraph --><p>Updated</p><!-- /wp:paragraph -->";
		const result = await execute("blu-editor/edit-block", {
			clientId: "paragraph-1",
			blockContent: markup,
		});
		expect(window.wp.blocks.parse).toHaveBeenCalledWith(markup);
		expect(dispatch.replaceBlock).toHaveBeenCalledWith(
			"paragraph-1",
			expect.objectContaining({ clientId: "replacement-1" })
		);
		expect(result).toMatchObject({
			changed: true,
			clientId: "paragraph-1",
			replacementClientId: "replacement-1",
			name: "core/paragraph",
		});
		expect(result.action).toBeUndefined();
		expect(result.arguments).toBeUndefined();
	});

	it("requires complete markup containing exactly one replacement block", async () => {
		window.wp.blocks.parse.mockReturnValue([]);
		await expect(
			execute("blu-editor/edit-block", {
				clientId: "paragraph-1",
				blockContent: "<p>not block markup</p>",
			})
		).rejects.toThrow(/one.*block|complete.*markup/i);
		window.wp.blocks.parse.mockReturnValue([
			{ clientId: "one", name: "core/paragraph", attributes: {}, innerBlocks: [] },
			{ clientId: "two", name: "core/paragraph", attributes: {}, innerBlocks: [] },
		]);
		await expect(
			execute("blu-editor/edit-block", {
				clientId: "paragraph-1",
				blockContent: "<!-- wp:paragraph /--><!-- wp:paragraph /-->",
			})
		).rejects.toThrow(/one.*block/i);
		expect(dispatch.replaceBlock).not.toHaveBeenCalled();
	});

	it("dispatches normalized merged attributes and verifies final state", async () => {
		const result = await execute("blu-editor/update-block", {
			clientId: "paragraph-1",
			attributes: {
				content: "Updated",
				style: { spacing: { padding: ["2px"] } },
			},
		});
		expect(dispatch.updateBlockAttributes).toHaveBeenCalledWith("paragraph-1", {
			content: "Updated",
			style: {
				color: { text: "#111" },
				spacing: { margin: ["1px"], padding: ["2px"] },
			},
		});
		expect(result).toMatchObject({
			changed: true,
			clientId: "paragraph-1",
			name: "core/paragraph",
		});
		expect(result.attributes.content).toBe("Updated");
		expect(result.action).toBeUndefined();
	});

	it("does not dispatch an unchanged attribute patch", async () => {
		await expect(
			execute("blu-editor/update-block", {
				clientId: "paragraph-1",
				attributes: { content: "Old" },
			})
		).resolves.toMatchObject({ changed: false, clientId: "paragraph-1" });
		expect(dispatch.updateBlockAttributes).not.toHaveBeenCalled();
	});

	it("applies wrapper-targeted color patches to visible button children", async () => {
		await expect(
			execute("blu-editor/update-block", {
				clientId: "buttons-1",
				attributes: { backgroundColor: "pink" },
			})
		).resolves.toMatchObject({
			changed: true,
			clientId: "buttons-1",
			name: "core/buttons",
		});

		expect(dispatch.updateBlockAttributes).toHaveBeenCalledWith("button-1", {
			content: "Buy",
			backgroundColor: undefined,
			style: { color: { background: "pink" } },
		});
		expect(dispatch.updateBlockAttributes).not.toHaveBeenCalledWith("buttons-1", expect.anything());
	});

	it("limits wrapper-targeted colors to the selected button child", async () => {
		selectedBlockId = "button-1";

		await execute("blu-editor/update-block", {
			clientId: "buttons-1",
			attributes: { backgroundColor: "pink" },
		});

		expect(dispatch.updateBlockAttributes).toHaveBeenCalledWith(
			"button-1",
			expect.objectContaining({
				style: { color: { background: "pink" } },
			})
		);
		expect(dispatch.updateBlockAttributes).not.toHaveBeenCalledWith("button-2", expect.anything());
	});

	it("clears empty button presets when custom colors are supplied", async () => {
		await execute("blu-editor/update-block", {
			clientId: "button-1",
			attributes: {
				backgroundColor: "",
				textColor: "",
				className: "is-style-fill",
				style: {
					border: {},
					color: { background: "#E91E8C", text: "#FFFFFF" },
				},
			},
		});

		expect(dispatch.updateBlockAttributes).toHaveBeenCalledWith("button-1", {
			content: "Buy",
			className: "is-style-fill",
			backgroundColor: undefined,
			textColor: undefined,
			style: {
				border: {},
				color: { background: "#E91E8C", text: "#FFFFFF" },
			},
		});
	});

	it("validates stale IDs and edit locks before dispatch", async () => {
		await expect(
			execute("blu-editor/update-block", {
				clientId: "missing",
				attributes: { content: "No" },
			})
		).rejects.toThrow('Unknown clientId "missing"');
		selectors.canEditBlock.mockReturnValue(false);
		await expect(
			execute("blu-editor/edit-block", {
				clientId: "paragraph-1",
				blockContent: "<!-- wp:paragraph --><p>No</p><!-- /wp:paragraph -->",
			})
		).rejects.toThrow(/locked|cannot be edited/i);
		expect(dispatch.updateBlockAttributes).not.toHaveBeenCalled();
		expect(dispatch.replaceBlock).not.toHaveBeenCalled();
	});

	it.each(["canRemoveBlocks", "canRemoveBlock"])(
		"rejects replacement locks reported by %s before dispatch",
		async (selector) => {
			selectors[selector] = jest.fn().mockReturnValue(false);

			await expect(
				execute("blu-editor/edit-block", {
					clientId: "paragraph-1",
					blockContent: "<!-- wp:paragraph --><p>No</p><!-- /wp:paragraph -->",
				})
			).rejects.toThrow(/locked|cannot be replaced|cannot be removed/i);
			expect(dispatch.replaceBlock).not.toHaveBeenCalled();
		}
	);

	it.each([
		["core/site-logo", {}],
		["core/navigation", { ref: 42 }],
		["core/template-part", { slug: "header" }],
	])("rejects a %s target with normalized fallback before mutation", async (name, attributes) => {
		blocks["paragraph-1"] = { ...blocks["paragraph-1"], name, attributes };
		let error;
		try {
			await execute("blu-editor/update-block", {
				clientId: "paragraph-1",
				attributes: { style: {} },
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toMatchObject({
			name: "EditorAbilityUnsupportedError",
			mutated: false,
			fallbackTool: "blu-update-block-attrs",
			fallbackArguments: { client_id: "paragraph-1", attributes: { style: {} } },
		});
		expect(dispatch.updateBlockAttributes).not.toHaveBeenCalled();
	});

	it.each([
		["navigation", "core/navigation", { ref: 12 }],
		["template-part", "core/template-part", { slug: "header" }],
	])("rejects %s ancestry before mutation", async (clientId, name, attributes) => {
		blocks[clientId] = {
			clientId,
			name,
			attributes,
			innerBlocks: [],
		};
		roots[clientId] = "";
		roots["paragraph-1"] = clientId;
		let error;
		try {
			await execute("blu-editor/edit-block", {
				clientId: "paragraph-1",
				blockContent: "<!-- wp:paragraph --><p>No</p><!-- /wp:paragraph -->",
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toMatchObject({
			name: "EditorAbilityUnsupportedError",
			mutated: false,
			fallbackTool: "blu-edit-block",
			fallbackArguments: {
				client_id: "paragraph-1",
				block_content: "<!-- wp:paragraph --><p>No</p><!-- /wp:paragraph -->",
			},
		});
		expect(dispatch.replaceBlock).not.toHaveBeenCalled();
	});

	it("rejects unresolved image placeholders and generation requests before mutation", async () => {
		for (const input of [
			{
				clientId: "image-1",
				attributes: { url: "__IMG_1__" },
			},
			{
				clientId: "image-1",
				attributes: {},
				imagePrompt: "A mountain at sunrise",
			},
		]) {
			let error;
			try {
				await execute("blu-editor/update-block", input);
			} catch (caught) {
				error = caught;
			}
			expect(error).toMatchObject({
				name: "EditorAbilityUnsupportedError",
				mutated: false,
				fallbackTool: "blu-update-block-attrs",
			});
		}
		let editError;
		try {
			await execute("blu-editor/edit-block", {
				clientId: "paragraph-1",
				blockContent:
					'<!-- wp:image {"url":"__IMG_1__"} --><figure><img src="__IMG_1__"/></figure><!-- /wp:image -->',
				imagePrompts: [{ prompt: "A mountain" }],
			});
		} catch (caught) {
			editError = caught;
		}
		expect(editError).toMatchObject({
			name: "EditorAbilityUnsupportedError",
			mutated: false,
			fallbackTool: "blu-edit-block",
		});
		expect(dispatch.updateBlockAttributes).not.toHaveBeenCalled();
		expect(dispatch.replaceBlock).not.toHaveBeenCalled();
	});

	it("throws without fallback when the editor silently refuses an update", async () => {
		dispatch.updateBlockAttributes.mockImplementation(() => {});
		let error;
		try {
			await execute("blu-editor/update-block", {
				clientId: "paragraph-1",
				attributes: { content: "Refused" },
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect(error).toHaveProperty(
			"message",
			expect.stringMatching(/did not update|refused|locked/i)
		);
		expect(error).toHaveProperty("mutated", true);
		expect(error).not.toHaveProperty("fallbackTool");
		expect(error).not.toHaveProperty("fallbackArguments");
	});

	it("marks an update error when the target disappears after dispatch", async () => {
		dispatch.updateBlockAttributes.mockImplementation((clientId) => {
			delete blocks[clientId];
		});

		let error;
		try {
			await execute("blu-editor/update-block", {
				clientId: "paragraph-1",
				attributes: { content: "Updated" },
			});
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeInstanceOf(Error);
		expect(error).toHaveProperty("mutated", true);
		expect(error).not.toHaveProperty("fallbackTool");
	});

	it("throws without fallback when the editor silently refuses a replacement", async () => {
		dispatch.replaceBlock.mockImplementation(() => {});
		let error;
		try {
			await execute("blu-editor/edit-block", {
				clientId: "paragraph-1",
				blockContent: "<!-- wp:paragraph --><p>Refused</p><!-- /wp:paragraph -->",
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect(error).toHaveProperty("message", expect.stringMatching(/did not replace|locked/i));
		expect(error).toHaveProperty("mutated", true);
		expect(error).not.toHaveProperty("fallbackTool");
	});

	it("rejects a replacement whose nested block state differs after dispatch", async () => {
		const replacement = {
			clientId: "replacement-group",
			name: "core/group",
			attributes: { layout: { type: "constrained" } },
			innerBlocks: [
				{
					clientId: "replacement-child",
					name: "core/paragraph",
					attributes: { content: "Expected child" },
					innerBlocks: [],
				},
			],
		};
		window.wp.blocks.parse.mockReturnValue([replacement]);
		dispatch.replaceBlock.mockImplementation((clientId) => {
			delete blocks[clientId];
			blocks[replacement.clientId] = {
				...replacement,
				innerBlocks: [],
			};
		});

		let error;
		try {
			await execute("blu-editor/edit-block", {
				clientId: "paragraph-1",
				blockContent:
					"<!-- wp:group --><!-- wp:paragraph --><p>Expected child</p><!-- /wp:paragraph --><!-- /wp:group -->",
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(Error);
		expect(error).toHaveProperty("message", expect.stringMatching(/did not replace|incomplete/i));
		expect(error).toHaveProperty("mutated", true);
		expect(error).not.toHaveProperty("fallbackTool");
	});
});
