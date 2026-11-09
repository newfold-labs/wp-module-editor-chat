import { ready } from "@newfold-labs/editor-chat/editor-abilities";
import {
	bridgeAbilitiesToWebMCP,
	unbridgeAbilitiesFromWebMCP,
} from "@newfold-labs/editor-chat/webmcp-bridge";
import { isWebMCPSupported } from "@newfold-labs/editor-chat/webmcp-env";

const diagnostic =
	window.nfdEditorAbilities && typeof window.nfdEditorAbilities === "object"
		? window.nfdEditorAbilities
		: { ready };

diagnostic.isWebMCPSupported = isWebMCPSupported();
diagnostic.webmcp = ready.then((abilityNames) => bridgeAbilitiesToWebMCP(abilityNames));
diagnostic.unbridge = unbridgeAbilitiesFromWebMCP;
window.nfdEditorAbilities = diagnostic;
