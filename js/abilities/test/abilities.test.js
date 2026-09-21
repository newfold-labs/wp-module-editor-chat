/* global beforeEach, describe, expect, jest, test */

const mockRegisteredAbilities = new Map();

jest.mock(
	"@wordpress/abilities",
	() => ({
		getAbility: (name) => mockRegisteredAbilities.get(name),
		getAbilityCategory: () => null,
		registerAbility: (ability) => {
			mockRegisteredAbilities.set(ability.name, ability);
			return ability;
		},
		registerAbilityCategory: jest.fn(),
	}),
	{ virtual: true }
);

import { registerEditorAbilities } from "../abilities";

describe("editor abilities", () => {
	beforeEach(() => {
		mockRegisteredAbilities.clear();
		window.wp = undefined;
	});

	test("registers edit-block as a local action descriptor", async () => {
		const names = registerEditorAbilities();
		const ability = mockRegisteredAbilities.get("editor/edit-block");

		expect(names).toContain("editor/edit-block");
		expect(ability.input_schema.required).toEqual(["clientId", "blockContent"]);
		await expect(
			ability.callback({
				clientId: "block-id",
				blockContent: "<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->",
			})
		).resolves.toEqual({
			action: "edit_block",
			arguments: {
				client_id: "block-id",
				block_content: "<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->",
			},
		});
	});

	test.each([
		["image_prompts", [{ prompt: "A calm yoga studio" }]],
		["image_prompt", "A calm yoga studio"],
	])("normalizes legacy %s input for local edit-block", async (field, value) => {
		registerEditorAbilities();
		const ability = mockRegisteredAbilities.get("editor/edit-block");

		await expect(
			ability.callback({
				clientId: "block-id",
				blockContent: '<!-- wp:image --><figure><img src="__IMG_1__"/></figure><!-- /wp:image -->',
				[field]: value,
			})
		).resolves.toEqual(
			expect.objectContaining({
				arguments: expect.objectContaining({
					image_prompts: [{ prompt: "A calm yoga studio" }],
				}),
			})
		);
	});

	test.each([
		[
			"editor/move-block",
			{ clientId: "special", afterClientId: "target" },
			"blu-move-block",
			{ client_id: "special", target_client_id: "target", position: "after" },
		],
		["editor/remove-block", { clientId: "special" }, "blu-delete-block", { client_id: "special" }],
		[
			"editor/update-block",
			{ clientId: "special", attributes: { align: "wide" } },
			"blu-update-block-attrs",
			{ client_id: "special", attributes: { align: "wide" } },
		],
	])(
		"marks special-entity failures from %s with a typed fallback",
		async (abilityName, input, fallbackTool, fallbackArguments) => {
			registerEditorAbilities();
			const store = {
				getBlock: (clientId) => ({
					name: clientId === "special" ? "core/site-logo" : "core/paragraph",
					attributes: {},
					innerBlocks: [],
				}),
				getBlockOrder: () => ["special", "target"],
				getBlockRootClientId: () => "",
				getBlockIndex: (clientId) => (clientId === "special" ? 0 : 1),
				getBlockParents: () => [],
				canInsertBlockType: () => true,
			};
			window.wp = {
				data: {
					select: () => store,
					dispatch: () => ({}),
				},
			};

			let error;
			try {
				await mockRegisteredAbilities.get(abilityName).callback(input);
			} catch (caught) {
				error = caught;
			}

			expect(error).toBeInstanceOf(Error);
			expect(error.fallbackTool).toBe(fallbackTool);
			expect(error.fallbackArguments).toEqual(fallbackArguments);
		}
	);

	test("returns an empty update as a successful no-op", async () => {
		registerEditorAbilities();
		window.wp = {
			data: {
				select: () => ({
					getBlock: () => ({ name: "core/site-logo", attributes: {}, innerBlocks: [] }),
				}),
				dispatch: () => ({}),
			},
		};

		await expect(
			mockRegisteredAbilities.get("editor/update-block").callback({
				clientId: "special",
				attributes: {},
			})
		).resolves.toEqual({
			clientId: "special",
			name: "core/site-logo",
			attributes: {},
			updatedAttributes: [],
		});
	});

	test("delegates update-block placeholders without writing the literal token", async () => {
		registerEditorAbilities();
		const updateBlockAttributes = jest.fn();
		const store = {
			getBlock: () => ({ name: "core/group", attributes: {}, innerBlocks: [] }),
			getBlockParents: () => [],
			canEditBlock: () => true,
		};
		window.wp = {
			data: {
				select: () => store,
				dispatch: () => ({ updateBlockAttributes }),
			},
		};
		const input = {
			clientId: "group-1",
			attributes: {
				style: {
					background: {
						backgroundImage: { url: "__IMG_1__" },
					},
				},
			},
		};

		await expect(
			mockRegisteredAbilities.get("editor/update-block").callback(input)
		).resolves.toEqual({
			action: "update_block_attrs",
			arguments: {
				client_id: "group-1",
				attributes: input.attributes,
			},
		});
		expect(updateBlockAttributes).not.toHaveBeenCalled();
	});

	test("delegates image generation from update-block without requiring markup", async () => {
		registerEditorAbilities();
		const updateBlockAttributes = jest.fn();
		window.wp = {
			data: {
				select: () => ({
					getBlock: () => ({ name: "core/image", attributes: {}, innerBlocks: [] }),
					getBlockParents: () => [],
					canEditBlock: () => true,
				}),
				dispatch: () => ({ updateBlockAttributes }),
			},
		};

		await expect(
			mockRegisteredAbilities.get("editor/update-block").callback({
				clientId: "image-1",
				attributes: {},
				imagePrompt: "Mountain peaks stretching into the distance",
			})
		).resolves.toEqual({
			action: "update_block_attrs",
			arguments: {
				client_id: "image-1",
				attributes: {},
				image_prompt: "Mountain peaks stretching into the distance",
			},
		});
		expect(updateBlockAttributes).not.toHaveBeenCalled();
	});
});
