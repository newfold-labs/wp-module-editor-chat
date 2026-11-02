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

	it("registers exactly the implemented read and block-write abilities once", async () => {
		const implementedNames = ABILITY_NAMES.filter(
			(name) =>
				READ_ONLY_ABILITY_NAMES.slice(0, 10).includes(name) ||
				[
					"blu-editor/edit-block",
					"blu-editor/insert-block",
					"blu-editor/move-block",
					"blu-editor/remove-block",
					"blu-editor/update-block",
					"blu-editor/transform-block",
				].includes(name)
		);

		await expect(initializeEditorAbilities()).resolves.toEqual(implementedNames);
		await initializeEditorAbilities();

		expect(registerAbilityCategory).toHaveBeenCalledTimes(1);
		expect(registerAbility).toHaveBeenCalledTimes(16);
		expect(registerAbility.mock.calls.map(([definition]) => definition.name)).toEqual(
			implementedNames
		);
		expect(
			registerAbility.mock.calls.every(([definition]) => typeof definition.callback === "function")
		).toBe(true);
		expect(getRegisteredEditorAbilityNames()).toEqual(implementedNames);
		await expect(ready).resolves.toEqual(implementedNames);
	});

	it("ignores unknown and not-yet-implemented requested names", async () => {
		await expect(
			initializeEditorAbilities({
				abilityNames: ["blu-editor/get-editor-tree", "blu-editor/undo", "other/unknown"],
			})
		).resolves.toEqual(["blu-editor/get-editor-tree"]);
	});
});
