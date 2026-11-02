/* global describe, expect, it */

/**
 * External dependencies
 */
import { registerAbility, registerAbilityCategory } from "@wordpress/abilities";

/**
 * Internal dependencies
 */
import { ABILITY_NAMES, READ_ONLY_ABILITY_NAMES, WRITE_ABILITY_NAMES } from "../constants";
import { getRegisteredEditorAbilityNames, initializeEditorAbilities, ready } from "../index";

describe("editor ability registry", () => {
	it("publishes immutable, complete ability classifications", () => {
		expect(Object.isFrozen(ABILITY_NAMES)).toBe(true);
		expect(Object.isFrozen(READ_ONLY_ABILITY_NAMES)).toBe(true);
		expect(Object.isFrozen(WRITE_ABILITY_NAMES)).toBe(true);
		expect(ABILITY_NAMES).toHaveLength(21);
		expect(READ_ONLY_ABILITY_NAMES).toHaveLength(11);
		expect(WRITE_ABILITY_NAMES).toHaveLength(10);
		expect(READ_ONLY_ABILITY_NAMES.filter((name) => WRITE_ABILITY_NAMES.includes(name))).toEqual(
			[]
		);
		expect([...READ_ONLY_ABILITY_NAMES, ...WRITE_ABILITY_NAMES].sort()).toEqual(
			[...ABILITY_NAMES].sort()
		);
	});

	it("registers the complete public surface once in contract order", async () => {
		await expect(initializeEditorAbilities()).resolves.toEqual(ABILITY_NAMES);
		await initializeEditorAbilities();

		expect(registerAbilityCategory).toHaveBeenCalledTimes(1);
		expect(registerAbility).toHaveBeenCalledTimes(21);
		expect(registerAbility.mock.calls.map(([definition]) => definition.name)).toEqual(
			ABILITY_NAMES
		);
		for (const [definition] of registerAbility.mock.calls) {
			expect(definition).toEqual(
				expect.objectContaining({
					label: expect.any(String),
					description: expect.any(String),
					category: "blu-editor",
					input_schema: expect.any(Object),
					output_schema: expect.any(Object),
					callback: expect.any(Function),
				})
			);
			expect(definition.meta?.annotations).toEqual({
				readonly: READ_ONLY_ABILITY_NAMES.includes(definition.name),
				destructive: expect.any(Boolean),
				idempotent: expect.any(Boolean),
			});
		}
		expect(getRegisteredEditorAbilityNames()).toEqual(ABILITY_NAMES);
		expect(getRegisteredEditorAbilityNames()).toHaveLength(21);
		await expect(ready).resolves.toEqual(ABILITY_NAMES);
	});

	it("ignores unknown requested names", async () => {
		await expect(
			initializeEditorAbilities({
				abilityNames: ["blu-editor/get-editor-tree", "blu-editor/undo", "other/unknown"],
			})
		).resolves.toEqual(["blu-editor/get-editor-tree", "blu-editor/undo"]);
	});

	it("publishes complete output contracts for all six direct block writes", async () => {
		await initializeEditorAbilities();
		const expectedProperties = {
			"blu-editor/insert-block": [
				"changed",
				"clientId",
				"clientIds",
				"name",
				"rootClientId",
				"index",
				"innerBlockCount",
			],
			"blu-editor/move-block": [
				"changed",
				"clientId",
				"name",
				"rootClientId",
				"index",
				"previousRootClientId",
				"previousIndex",
			],
			"blu-editor/remove-block": [
				"changed",
				"clientId",
				"name",
				"rootClientId",
				"index",
				"removedInnerBlockCount",
			],
			"blu-editor/transform-block": [
				"changed",
				"previousClientId",
				"previousName",
				"name",
				"clientIds",
				"blocks",
				"count",
				"rootClientId",
				"index",
				"indexes",
			],
			"blu-editor/edit-block": ["changed", "clientId", "replacementClientId", "name", "attributes"],
			"blu-editor/update-block": ["changed", "clientId", "name", "attributes", "updatedAttributes"],
		};

		for (const [name, properties] of Object.entries(expectedProperties)) {
			const definition = registerAbility.mock.calls.find(([item]) => item.name === name)[0];
			expect(Object.keys(definition.output_schema.properties)).toEqual(properties);
			expect(definition.output_schema.required).toEqual(properties);
			expect(definition.output_schema.additionalProperties).toBe(false);
		}
	});
});
