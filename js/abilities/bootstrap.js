import { getRegisteredEditorAbilityNames, ready } from "@newfold-labs/editor-chat/editor-abilities";

const diagnostic =
	window.nfdEditorAbilities && typeof window.nfdEditorAbilities === "object"
		? window.nfdEditorAbilities
		: {};

diagnostic.ready = ready;
diagnostic.registeredNames = getRegisteredEditorAbilityNames();
window.nfdEditorAbilities = diagnostic;

ready.then((names) => {
	diagnostic.registeredNames = names;
});
