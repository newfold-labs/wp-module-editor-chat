import { requireBlock, requireEditorActions, requireEditorStore } from "./editor-store.js";

const EDITOR_STORE = "core/editor";
const READ_ONLY_META = {
	annotations: { readonly: true, destructive: false, idempotent: true },
};
const HISTORY_META = {
	annotations: { readonly: false, destructive: true, idempotent: false },
};

function requireHistory(direction) {
	const select = window.wp?.data?.select;
	const dispatch = window.wp?.data?.dispatch;
	if (typeof select !== "function" || typeof dispatch !== "function") {
		throw new Error("WordPress data store is not available.");
	}
	const selectors = select(EDITOR_STORE);
	const actions = dispatch(EDITOR_STORE);
	const selectorName = direction === "undo" ? "hasEditorUndo" : "hasEditorRedo";
	if (
		typeof selectors?.[selectorName] !== "function" ||
		typeof actions?.[direction] !== "function"
	) {
		throw new Error(`Editor history is not available, so ${direction} cannot run.`);
	}
	return { selectors, actions, selectorName };
}

async function selectBlock({ clientId } = {}) {
	const store = requireEditorStore();
	const block = requireBlock(store, clientId);
	const actions = requireEditorActions();
	const previousClientId = store.getSelectedBlockClientId?.() || null;
	await actions.selectBlock(clientId);
	if (
		typeof store.getSelectedBlockClientId === "function" &&
		store.getSelectedBlockClientId() !== clientId
	) {
		throw new Error(`The editor did not select block ${clientId}.`);
	}
	return {
		changed: false,
		selected: true,
		clientId,
		name: block.name,
		rootClientId: store.getBlockRootClientId?.(clientId) || null,
		index: store.getBlockIndex?.(clientId) ?? -1,
		previousClientId,
	};
}

async function stepHistory(direction) {
	const { selectors, actions, selectorName } = requireHistory(direction);
	if (!selectors[selectorName]()) {
		throw new Error(`There is nothing to ${direction}.`);
	}
	await actions[direction]();
	return { changed: true, direction };
}

export function registerEditorUiAbilities(register) {
	const base = {
		category: "blu-editor",
		input_schema: { type: "object", properties: {}, additionalProperties: false },
		output_schema: {
			type: "object",
			properties: {
				changed: { type: "boolean" },
				direction: { type: "string", enum: ["undo", "redo"] },
			},
			required: ["changed", "direction"],
		},
	};
	const definitions = [
		{
			...base,
			name: "blu-editor/select-block",
			label: "Select Block",
			description: "Selects a validated block without changing the document.",
			input_schema: {
				type: "object",
				properties: { clientId: { type: "string" } },
				required: ["clientId"],
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					changed: { type: "boolean" },
					selected: { type: "boolean" },
					clientId: { type: "string" },
					name: { type: "string" },
					rootClientId: { type: ["string", "null"] },
					index: { type: "integer" },
					previousClientId: { type: ["string", "null"] },
				},
				required: ["changed", "selected", "clientId", "name"],
			},
			meta: READ_ONLY_META,
			callback: selectBlock,
		},
		{
			...base,
			name: "blu-editor/undo",
			label: "Undo",
			description: "Undoes the most recent available editor history step.",
			meta: HISTORY_META,
			callback: () => stepHistory("undo"),
		},
		{
			...base,
			name: "blu-editor/redo",
			label: "Redo",
			description: "Redoes the most recent available editor history step.",
			meta: HISTORY_META,
			callback: () => stepHistory("redo"),
		},
	];
	return definitions.filter((definition) => register(definition)).map(({ name }) => name);
}
