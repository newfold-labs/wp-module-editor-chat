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
});
