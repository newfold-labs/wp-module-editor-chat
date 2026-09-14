/**
 * Local editor abilities — bootstrap entry.
 *
 * Registers the editor/* abilities (abilities.js) then bridges the subset
 * PHP has enabled (LocalAbilities::get_enabled_ability_names(), read back
 * here from script_module_data) to WebMCP (webmcp-bridge.js), so the chat
 * (a separate bundle — see src/services/localToolRegistry.js) can call them
 * through document.modelContext with zero network cost.
 */

import { registerEditorAbilities } from "@newfold-labs/editor-chat-abilities";
import {
	bridgeAbilitiesToWebMCP,
	isWebMCPSupported,
	toToolName,
} from "@newfold-labs/editor-chat-webmcp-bridge";

/**
 * Read the ability names PHP enabled for this request.
 *
 * Uses the exact pattern WordPress core documents for reading script module
 * data (see wp-includes/class-wp-script-modules.php, print_script_module_data()).
 *
 * @return {string[]} The ability names PHP allowed for this request.
 */
function getAllowedAbilityNames() {
	const dataContainer = document.querySelector(
		'script[id="wp-script-module-data-@newfold-labs/editor-chat-local-abilities"]'
	);
	let data = {};
	if (dataContainer instanceof window.HTMLScriptElement) {
		try {
			data = JSON.parse(dataContainer.text);
		} catch {}
	}
	return Array.isArray(data?.abilityNames) ? data.abilityNames : [];
}

/** @type {Promise<void>|null} */
let bootstrapPromise = null;

async function bootstrap() {
	if (bootstrapPromise) {
		return bootstrapPromise;
	}

	bootstrapPromise = (async () => {
		const registeredNames = registerEditorAbilities();
		const allowedNames = getAllowedAbilityNames();
		const abilityNames = registeredNames.filter((name) => allowedNames.includes(name));

		window.nfdEditorAbilities = {
			abilityNames,
			webmcp: null,
			isWebMCPSupported: isWebMCPSupported(),
		};

		const bridgeResult = await bridgeAbilitiesToWebMCP(abilityNames);

		window.nfdEditorAbilities = {
			abilityNames,
			webmcp: bridgeResult,
			isWebMCPSupported: isWebMCPSupported(),
		};

		if (bridgeResult.supported) {
			console.info(
				"[nfd-editor-chat] Registered local editor abilities with WebMCP:",
				bridgeResult.registered.map(toToolName)
			);
		} else {
			console.info(
				"[nfd-editor-chat] Editor abilities registered, but WebMCP is unavailable and the polyfill could not install (this page may not be a secure context).",
				abilityNames
			);
		}
	})();

	return bootstrapPromise;
}

bootstrap().catch((error) => {
	bootstrapPromise = null;
	console.error("[nfd-editor-chat] Failed to bootstrap local editor abilities:", error);
});
