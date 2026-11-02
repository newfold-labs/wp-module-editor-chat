import { EditorAbilityUnsupportedError } from "./ability-errors";
import { deepMergeAttributes, normalizeAttributes } from "./block-attribute-validation";
import { requireBlock, requireEditorActions, requireEditorStore } from "./editor-store";

const WRITE_META = (destructive = false, idempotent = false) => ({
	annotations: { readonly: false, destructive, idempotent },
});

function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasImagePlaceholder(value) {
	if (typeof value === "string") {
		return /__(?:IMG|IMAGE)_?\d*__/i.test(value);
	}
	if (Array.isArray(value)) {
		return value.some(hasImagePlaceholder);
	}
	return isPlainObject(value) && Object.values(value).some(hasImagePlaceholder);
}

function isSpecial(block) {
	return (
		block?.name === "core/site-logo" ||
		block?.name === "core/template-part" ||
		(block?.name === "core/navigation" && !!block.attributes?.ref)
	);
}

function findSpecial(store, clientId) {
	let currentId = clientId;
	while (currentId) {
		const block = store.getBlock(currentId);
		if (isSpecial(block)) {
			return block;
		}
		currentId = store.getBlockRootClientId?.(currentId) || "";
	}
	return null;
}

function rejectSpecial(store, clientId, fallback) {
	const special = findSpecial(store, clientId);
	if (special) {
		throw new EditorAbilityUnsupportedError(
			`"${special.name}" is managed separately and is not supported by this ability.`,
			fallback
		);
	}
}

function assertEditable(store, block) {
	if (
		store.canEditBlock?.(block.clientId) === false ||
		store.getBlockEditingMode?.(block.clientId) === "disabled" ||
		block.attributes?.lock?.edit === true
	) {
		throw new Error(`Block "${block.name}" cannot be edited. It may be locked for editing.`);
	}
}

function assertReplaceable(store, block) {
	if (
		store.canRemoveBlocks?.([block.clientId]) === false ||
		store.canRemoveBlock?.(block.clientId) === false
	) {
		throw new Error(`Block "${block.name}" cannot be replaced. It may be locked for removal.`);
	}
}

function normalizeImagePrompts(input) {
	const plural = input.imagePrompts ?? input.image_prompts;
	const singular = input.imagePrompt ?? input.image_prompt;
	if (plural !== undefined && !Array.isArray(plural)) {
		throw new Error("imagePrompts must be an array.");
	}
	if (singular === undefined) {
		return plural;
	}
	return plural ?? [typeof singular === "string" ? { prompt: singular } : singular];
}

function editFallback(input, imagePrompts) {
	return {
		tool: "blu-edit-block",
		arguments: {
			client_id: input.clientId,
			block_content: input.blockContent,
			...(imagePrompts ? { image_prompts: imagePrompts } : {}),
			...(input.imageUrls ? { image_urls: input.imageUrls } : {}),
		},
	};
}

function updateFallback(input, imagePrompt) {
	return {
		tool: "blu-update-block-attrs",
		arguments: {
			client_id: input.clientId,
			attributes: input.attributes ?? {},
			...(imagePrompt !== undefined ? { image_prompt: imagePrompt } : {}),
		},
	};
}

function equalJsonValue(left, right) {
	if (left === right) {
		return true;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((value, index) => equalJsonValue(value, right[index]))
		);
	}
	if (isPlainObject(left) || isPlainObject(right)) {
		if (!isPlainObject(left) || !isPlainObject(right)) {
			return false;
		}
		const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
		return [...keys].every((key) => equalJsonValue(left[key], right[key]));
	}
	return false;
}

function equalBlockState(actual, expected) {
	if (
		!actual ||
		!expected ||
		actual.name !== expected.name ||
		!equalJsonValue(actual.attributes ?? {}, expected.attributes ?? {})
	) {
		return false;
	}
	const actualInner = actual.innerBlocks ?? [];
	const expectedInner = expected.innerBlocks ?? [];
	return (
		actualInner.length === expectedInner.length &&
		actualInner.every((block, index) => equalBlockState(block, expectedInner[index]))
	);
}

async function editBlock(input = {}) {
	const store = requireEditorStore();
	const block = requireBlock(store, input.clientId);
	if (typeof input.blockContent !== "string" || !input.blockContent.trim()) {
		throw new Error("blockContent must be non-empty WordPress block markup.");
	}
	if (input.imageUrls !== undefined && !Array.isArray(input.imageUrls)) {
		throw new Error("imageUrls must be an array.");
	}
	const imagePrompts = normalizeImagePrompts(input);
	const fallback = editFallback(input, imagePrompts);
	assertEditable(store, block);
	assertReplaceable(store, block);
	rejectSpecial(store, input.clientId, fallback);
	if (
		imagePrompts !== undefined ||
		input.imageUrls !== undefined ||
		hasImagePlaceholder(input.blockContent)
	) {
		throw new EditorAbilityUnsupportedError(
			"Image generation and unresolved image placeholders require the image-aware editor handler.",
			fallback
		);
	}
	const parse = window.wp?.blocks?.parse;
	if (typeof parse !== "function") {
		throw new Error("WordPress block parsing is not available.");
	}
	if (!/<!--\s+wp:/.test(input.blockContent)) {
		throw new Error("blockContent must contain complete WordPress block markup for one block.");
	}
	const parsed = parse(input.blockContent);
	if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0]?.name) {
		throw new Error("blockContent must parse to exactly one complete WordPress block.");
	}
	const replacement = parsed[0];
	const actions = requireEditorActions();
	if (typeof actions.replaceBlock !== "function") {
		throw new Error("Block replacement is not available.");
	}
	await actions.replaceBlock(input.clientId, replacement);
	const actual = store.getBlock(replacement.clientId);
	if (
		!equalBlockState(actual, replacement) ||
		(replacement.clientId !== input.clientId && store.getBlock(input.clientId))
	) {
		throw new Error("The editor did not replace this block. It or its parent may be locked.");
	}
	return {
		changed: true,
		clientId: input.clientId,
		replacementClientId: actual.clientId,
		name: actual.name,
		attributes: actual.attributes ?? {},
	};
}

async function updateBlock(input = {}) {
	const store = requireEditorStore();
	const block = requireBlock(store, input.clientId);
	const attributes = input.attributes ?? {};
	if (!isPlainObject(attributes)) {
		throw new Error("attributes must be an object.");
	}
	const imagePrompt = input.imagePrompt ?? input.image_prompt;
	const fallback = updateFallback(input, imagePrompt);
	assertEditable(store, block);
	rejectSpecial(store, input.clientId, fallback);
	if (imagePrompt !== undefined || hasImagePlaceholder(attributes)) {
		throw new EditorAbilityUnsupportedError(
			"Image generation and unresolved image placeholders require the image-aware editor handler.",
			fallback
		);
	}
	const normalized = normalizeAttributes(block.name, attributes);
	const merged = deepMergeAttributes(block.attributes ?? {}, normalized);
	if (equalJsonValue(block.attributes ?? {}, merged)) {
		return {
			changed: false,
			clientId: input.clientId,
			name: block.name,
			attributes: block.attributes ?? {},
			updatedAttributes: [],
		};
	}
	const actions = requireEditorActions();
	await actions.updateBlockAttributes(input.clientId, merged);
	const updated = requireBlock(store, input.clientId);
	const actual = updated.attributes ?? {};
	const notApplied = Object.keys(merged).filter((key) => !equalJsonValue(actual[key], merged[key]));
	if (notApplied.length) {
		throw new Error(`The editor did not update attribute(s): ${notApplied.join(", ")}.`);
	}
	return {
		changed: true,
		clientId: input.clientId,
		name: updated.name,
		attributes: actual,
		updatedAttributes: Object.keys(normalized),
	};
}

export function registerBlockContentAbilities(register) {
	const imagePrompt = { oneOf: [{ type: "string" }, { type: "object" }] };
	const base = { category: "blu-editor", output_schema: { type: "object" } };
	const definitions = [
		{
			...base,
			name: "blu-editor/edit-block",
			label: "Edit Block Content",
			description: "Replaces one block from complete WordPress block markup.",
			input_schema: {
				type: "object",
				properties: {
					clientId: { type: "string" },
					blockContent: { type: "string" },
					imagePrompts: { type: "array", items: imagePrompt },
					image_prompts: { type: "array", items: imagePrompt },
					imagePrompt,
					image_prompt: imagePrompt,
					imageUrls: { type: "array", items: { type: "string" } },
				},
				required: ["clientId", "blockContent"],
				additionalProperties: false,
			},
			meta: WRITE_META(true),
			callback: editBlock,
		},
		{
			...base,
			name: "blu-editor/update-block",
			label: "Update Block",
			description: "Validates and merges attributes into one live editor block.",
			input_schema: {
				type: "object",
				properties: {
					clientId: { type: "string" },
					attributes: { type: "object" },
					imagePrompt,
					image_prompt: imagePrompt,
				},
				required: ["clientId"],
				additionalProperties: false,
			},
			meta: WRITE_META(false, true),
			callback: updateBlock,
		},
	];
	return definitions.filter((definition) => register(definition)).map(({ name }) => name);
}
