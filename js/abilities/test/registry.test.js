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

	it("registers only the currently implemented ability once", async () => {
		await expect(initializeEditorAbilities()).resolves.toEqual(["blu-editor/get-editor-tree"]);
		await initializeEditorAbilities();

		expect(registerAbilityCategory).toHaveBeenCalledTimes(1);
		expect(registerAbility).toHaveBeenCalledTimes(1);
		expect(registerAbility.mock.calls[0][0].name).toBe("blu-editor/get-editor-tree");
		expect(getRegisteredEditorAbilityNames()).toEqual(["blu-editor/get-editor-tree"]);
		await expect(ready).resolves.toEqual(["blu-editor/get-editor-tree"]);
	});

	it("ignores unknown and not-yet-implemented requested names", async () => {
		await expect(
			initializeEditorAbilities({
				abilityNames: ["blu-editor/get-editor-tree", "blu-editor/update-block", "other/unknown"],
			})
		).resolves.toEqual(["blu-editor/get-editor-tree"]);
	});
});
