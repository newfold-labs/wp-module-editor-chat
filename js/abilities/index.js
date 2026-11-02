import { registerAbility, registerAbilityCategory } from "@wordpress/abilities";

import { registerBlockCatalogAbilities } from "./block-catalog-abilities";
import { registerBlockContentAbilities } from "./block-content-abilities";
import { registerBlockStructureAbilities } from "./block-structure-abilities";
import { registerBlockTreeAbilities } from "./block-tree-abilities";
import { ABILITY_NAMES } from "./constants";
import { registerPatternReadAbilities } from "./pattern-read-abilities";

export { ABILITY_NAMES, READ_ONLY_ABILITY_NAMES, WRITE_ABILITY_NAMES } from "./constants";

const registeredNames = new Set();
let categoryRegistered = false;

/**
 * Read the server-filtered allow-list for this module.
 *
 * @return {string[]} Allowed names, or the complete contract by default.
 */
function getConfiguredAbilityNames() {
	if (typeof document === "undefined") {
		return ABILITY_NAMES;
	}
	const element = document.querySelector(
		'script[id="wp-script-module-data-@newfold-labs/editor-chat/editor-abilities"]'
	);
	if (!element) {
		return ABILITY_NAMES;
	}
	try {
		const data = JSON.parse(element.textContent || "{}");
		return Array.isArray(data.abilityNames) ? data.abilityNames : ABILITY_NAMES;
	} catch {
		return ABILITY_NAMES;
	}
}

/**
 * Register one definition at most once.
 *
 * @param {Object} definition Ability definition.
 * @return {boolean} Whether this call registered it.
 */
function register(definition) {
	if (registeredNames.has(definition.name)) {
		return false;
	}
	registerAbility(definition);
	registeredNames.add(definition.name);
	return true;
}

/**
 * Initialize allowed, currently implemented editor abilities.
 *
 * @param {Object}   options              Options.
 * @param {string[]} options.abilityNames Allowed public names.
 * @return {Promise<string[]>} Registered implemented names.
 */
export async function initializeEditorAbilities({
	abilityNames = getConfiguredAbilityNames(),
} = {}) {
	if (!categoryRegistered) {
		registerAbilityCategory("blu-editor", {
			label: "Editor",
			description: "Abilities for inspecting and modifying the WordPress block editor.",
		});
		categoryRegistered = true;
	}

	const allowed = new Set(
		Array.isArray(abilityNames)
			? abilityNames.filter((name) => ABILITY_NAMES.includes(name))
			: ABILITY_NAMES
	);

	registerBlockTreeAbilities((definition) => allowed.has(definition.name) && register(definition));
	registerBlockCatalogAbilities(
		(definition) => allowed.has(definition.name) && register(definition)
	);
	registerPatternReadAbilities(
		(definition) => allowed.has(definition.name) && register(definition)
	);
	const blockWriteDefinitions = new Map();
	const collectBlockWrite = (definition) => {
		blockWriteDefinitions.set(definition.name, definition);
		return true;
	};
	registerBlockStructureAbilities(collectBlockWrite);
	registerBlockContentAbilities(collectBlockWrite);
	for (const name of ABILITY_NAMES) {
		const definition = blockWriteDefinitions.get(name);
		if (definition && allowed.has(name)) {
			register(definition);
		}
	}

	return getRegisteredEditorAbilityNames().filter((name) => allowed.has(name));
}

/**
 * Return successfully registered public names.
 *
 * @return {string[]} Registered names in contract order.
 */
export function getRegisteredEditorAbilityNames() {
	return ABILITY_NAMES.filter((name) => registeredNames.has(name));
}

export const ready = initializeEditorAbilities();
