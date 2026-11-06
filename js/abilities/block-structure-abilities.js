import { EditorAbilityUnsupportedError, markAbilityMutationError } from "./ability-errors.js";
import { requireBlock, requireEditorActions, requireEditorStore } from "./editor-store.js";

const WRITE_META = (destructive = false, idempotent = false) => ({
	annotations: { readonly: false, destructive, idempotent },
});

function requireBlocksApi() {
	const api = window.wp?.blocks;
	if (!api?.createBlock) {
		throw new Error("WordPress blocks API is not available.");
	}
	return api;
}

function getBlockType(name) {
	if (typeof name !== "string" || !name) {
		throw new Error("name must be a registered block name.");
	}
	const api = requireBlocksApi();
	const type =
		api.getBlockType?.(name) ?? window.wp?.data?.select?.("core/blocks")?.getBlockType?.(name);
	if (!type) {
		throw new Error(`Block type is not registered: ${name}`);
	}
	return type;
}

function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateAttributes(name, attributes, path) {
	if (!isPlainObject(attributes)) {
		throw new Error(`${path} must be an object.`);
	}
	const schema = getBlockType(name).attributes || {};
	for (const [key, value] of Object.entries(attributes)) {
		const definition = schema[key];
		if (!definition || value === null || !definition.type) {
			continue;
		}
		const types = Array.isArray(definition.type) ? definition.type : [definition.type];
		const valid = types.some(
			(type) =>
				(type === "array" && Array.isArray(value)) ||
				(type === "object" && isPlainObject(value)) ||
				(type === "integer" && Number.isInteger(value)) ||
				(type === "number" && typeof value === "number") ||
				(type === "boolean" && typeof value === "boolean") ||
				// Rich text attributes (paragraph/heading content, etc.) are HTML strings.
				((type === "string" || type === "rich-text") && typeof value === "string") ||
				(type === "null" && value === null) ||
				// Unknown types must not block valid input.
				!["array", "object", "integer", "number", "boolean", "string", "rich-text", "null"].includes(
					type
				)
		);
		if (!valid) {
			throw new Error(`${path}.${key} must be ${types.join(" or ")}.`);
		}
	}
}

function assertNesting(parentName, childName, ancestorNames, path) {
	const parent = getBlockType(parentName);
	const child = getBlockType(childName);
	if (Array.isArray(child.parent) && !child.parent.includes(parentName)) {
		throw new Error(`${path}: "${childName}" cannot be nested inside "${parentName}".`);
	}
	if (
		Array.isArray(child.ancestor) &&
		!child.ancestor.some((name) => ancestorNames.includes(name))
	) {
		throw new Error(
			`${path}: "${childName}" requires an ancestor of ${child.ancestor.join(", ")}.`
		);
	}
	if (Array.isArray(parent.allowedBlocks) && !parent.allowedBlocks.includes(childName)) {
		throw new Error(`${path}: "${parentName}" does not allow "${childName}".`);
	}
}

export function buildBlock(spec, path = "block", ancestorNames = []) {
	if (!isPlainObject(spec)) {
		throw new Error(`${path} must be an object with a block name.`);
	}
	getBlockType(spec.name);
	const parentName = ancestorNames[ancestorNames.length - 1];
	if (parentName) {
		assertNesting(parentName, spec.name, ancestorNames, path);
	}
	const attributes = spec.attributes ?? {};
	validateAttributes(spec.name, attributes, `${path}.attributes`);
	const children = spec.innerBlocks ?? [];
	if (!Array.isArray(children)) {
		throw new Error(`${path}.innerBlocks must be an array.`);
	}
	const innerBlocks = children.map((child, index) =>
		buildBlock(child, `${path}.innerBlocks[${index}]`, [...ancestorNames, spec.name])
	);
	return requireBlocksApi().createBlock(spec.name, attributes, innerBlocks);
}

function rootOf(store, clientId) {
	return store.getBlockRootClientId(clientId) || "";
}

function indexOf(store, clientId, rootClientId = rootOf(store, clientId)) {
	return store.getBlockIndex(clientId, rootClientId);
}

function validateIndex(index) {
	if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
		throw new Error("index must be an integer zero or greater.");
	}
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
		currentId = rootOf(store, currentId);
	}
	return null;
}

function rejectSpecial(store, clientId, fallback = null) {
	const special = findSpecial(store, clientId);
	if (special) {
		throw new EditorAbilityUnsupportedError(
			`"${special.name}" is managed separately and is not supported by this ability.`,
			fallback
		);
	}
}

export function assertSafeBlockMutationTarget(store, clientId) {
	rejectSpecial(store, clientId);
}

function assertCanInsert(store, name, rootClientId) {
	if (!store.canInsertBlockType?.(name, rootClientId || undefined)) {
		throw new Error(`Block type "${name}" cannot be inserted at the requested location.`);
	}
}

function getDestinationAncestorNames(store, rootClientId) {
	if (!rootClientId) {
		return [];
	}
	return [rootClientId, ...(store.getBlockParents?.(rootClientId) || [])]
		.map((clientId) => store.getBlock(clientId)?.name)
		.filter(Boolean);
}

function assertDestinationNesting(store, name, rootClientId) {
	if (!rootClientId) {
		const blockType = getBlockType(name);
		if (Array.isArray(blockType.parent) && blockType.parent.length) {
			throw new Error(`"${name}" requires a parent of ${blockType.parent.join(", ")}.`);
		}
		if (Array.isArray(blockType.ancestor) && blockType.ancestor.length) {
			throw new Error(`"${name}" requires an ancestor of ${blockType.ancestor.join(", ")}.`);
		}
		return;
	}
	const ancestors = getDestinationAncestorNames(store, rootClientId);
	assertNesting(ancestors[0], name, ancestors, "destination");
}

export function assertBlockCanInsertAtDestination(store, name, rootClientId = "") {
	if (rootClientId) {
		rejectSpecial(store, rootClientId);
	}
	assertDestinationNesting(store, name, rootClientId);
	assertCanInsert(store, name, rootClientId);
}

function resolveRoot(store, name, requestedRoot) {
	if (requestedRoot || store.canInsertBlockType?.(name, undefined)) {
		return requestedRoot || "";
	}
	const ids =
		store.getBlocksByName?.("core/post-content") ??
		(store.getBlocks?.() || [])
			.filter(({ name: blockName }) => blockName === "core/post-content")
			.map(({ clientId }) => clientId);
	return (
		(ids || []).find((id) => {
			const block = store.getBlock(id);
			return block && store.canInsertBlockType?.(name, id);
		}) || ""
	);
}

export function resolveBlockInsertRoot(store, name, requestedRoot = "") {
	return resolveRoot(store, name, requestedRoot);
}

function moveFallback(store, input) {
	const args = { client_id: input.clientId };
	if (input.afterClientId) {
		return {
			tool: "blu-move-block",
			arguments: { ...args, target_client_id: input.afterClientId, position: "after" },
		};
	}
	if (input.beforeClientId) {
		return {
			tool: "blu-move-block",
			arguments: { ...args, target_client_id: input.beforeClientId, position: "before" },
		};
	}
	const root = input.rootClientId || "";
	const order = (store.getBlockOrder?.(root) || []).filter((id) => id !== input.clientId);
	const index = input.index === undefined ? order.length : Math.min(input.index, order.length);
	if (order[index]) {
		return {
			tool: "blu-move-block",
			arguments: { ...args, target_client_id: order[index], position: "before" },
		};
	}
	if (order.length) {
		return {
			tool: "blu-move-block",
			arguments: { ...args, target_client_id: order[order.length - 1], position: "after" },
		};
	}
	return root ? { tool: "blu-move-block", arguments: { ...args, as_child_of: root } } : null;
}

async function insertBlock(input = {}) {
	const store = requireEditorStore();
	const actions = requireEditorActions();
	getBlockType(input.name);
	validateIndex(input.index);
	if (input.rootClientId) {
		requireBlock(store, input.rootClientId, "rootClientId");
	}
	const hasAfterClientId = Object.prototype.hasOwnProperty.call(input, "afterClientId");
	let rootClientId = input.rootClientId || "";
	let index = input.index;
	if (hasAfterClientId) {
		requireBlock(store, input.afterClientId, "afterClientId");
		const siblingRoot = rootOf(store, input.afterClientId);
		if (input.rootClientId && input.rootClientId !== siblingRoot) {
			throw new Error("afterClientId is not a child of the provided rootClientId.");
		}
		rootClientId = siblingRoot;
		index = indexOf(store, input.afterClientId, siblingRoot) + 1;
	}
	if (hasAfterClientId && !store.canInsertBlockType?.(input.name, rootClientId || undefined)) {
		throw new Error(
			`Block type "${input.name}" cannot be inserted after the requested afterClientId.`
		);
	}
	if (!hasAfterClientId) {
		rootClientId = resolveRoot(store, input.name, rootClientId);
	}
	if (rootClientId) {
		requireBlock(store, rootClientId, "rootClientId");
		rejectSpecial(store, rootClientId);
	}
	assertDestinationNesting(store, input.name, rootClientId);
	assertCanInsert(store, input.name, rootClientId);
	const block = buildBlock({
		name: input.name,
		attributes: input.attributes,
		innerBlocks: input.innerBlocks,
	});
	const order = store.getBlockOrder?.(rootClientId) || [];
	const requestedIndex = index === undefined ? order.length : Math.min(index, order.length);
	if (actions.insertBlocks) {
		try {
			await actions.insertBlocks([block], requestedIndex, rootClientId);
		} catch (error) {
			throw markAbilityMutationError(error);
		}
	} else {
		try {
			await actions.insertBlock(block, requestedIndex, rootClientId || undefined);
		} catch (error) {
			throw markAbilityMutationError(error);
		}
	}
	const inserted = store.getBlock(block.clientId);
	if (!inserted) {
		throw markAbilityMutationError(
			new Error("The editor did not insert this block. Its destination may be locked.")
		);
	}
	const actualRoot = rootOf(store, block.clientId);
	const actualIndex = indexOf(store, block.clientId, actualRoot);
	return {
		changed: true,
		clientId: block.clientId,
		clientIds: [block.clientId],
		name: block.name,
		rootClientId: actualRoot,
		index: actualIndex,
		innerBlockCount: block.innerBlocks?.length || 0,
	};
}

async function moveBlock(input = {}) {
	const store = requireEditorStore();
	const block = requireBlock(store, input.clientId);
	validateIndex(input.index);
	const hasAfterClientId = Object.prototype.hasOwnProperty.call(input, "afterClientId");
	const hasBeforeClientId = Object.prototype.hasOwnProperty.call(input, "beforeClientId");
	if (hasAfterClientId && hasBeforeClientId) {
		throw new Error("Provide only one of afterClientId or beforeClientId.");
	}
	if (input.rootClientId) {
		requireBlock(store, input.rootClientId, "rootClientId");
	}
	const hasSibling = hasAfterClientId || hasBeforeClientId;
	const siblingId = hasAfterClientId ? input.afterClientId : input.beforeClientId;
	if (hasSibling) {
		requireBlock(store, siblingId, hasAfterClientId ? "afterClientId" : "beforeClientId");
		if (siblingId === input.clientId) {
			throw new Error("A sibling reference must be a different block.");
		}
	}
	const fromRoot = rootOf(store, input.clientId);
	const fromIndex = indexOf(store, input.clientId, fromRoot);
	let toRoot = input.rootClientId || "";
	let toIndex;
	if (hasSibling) {
		toRoot = rootOf(store, siblingId);
		if (input.rootClientId && input.rootClientId !== toRoot) {
			throw new Error("Sibling is not a child of the provided rootClientId.");
		}
		const siblingIndex = indexOf(store, siblingId, toRoot);
		toIndex = siblingIndex + (hasAfterClientId ? 1 : 0);
		if (toRoot === fromRoot && siblingIndex > fromIndex) {
			toIndex -= 1;
		}
	} else {
		const order = store.getBlockOrder?.(toRoot) || [];
		const max = toRoot === fromRoot ? Math.max(0, order.length - 1) : order.length;
		toIndex = input.index === undefined ? max : Math.min(input.index, max);
	}
	if (toRoot === input.clientId) {
		throw new Error("A block cannot be moved into itself.");
	}
	if (toRoot && (store.getBlockParents?.(toRoot) || []).includes(input.clientId)) {
		throw new Error("A block cannot be moved into one of its own descendants.");
	}
	assertDestinationNesting(store, block.name, toRoot);
	if (toRoot !== fromRoot) {
		assertCanInsert(store, block.name, toRoot);
	}
	const fallback = moveFallback(store, input);
	rejectSpecial(store, input.clientId, fallback);
	if (toRoot) {
		rejectSpecial(store, toRoot, fallback);
	}
	if (
		store.canMoveBlocks?.([input.clientId], fromRoot, toRoot) === false ||
		store.canMoveBlock?.(input.clientId, toRoot) === false
	) {
		throw new Error(`Block "${block.name}" cannot be moved. It or its parent may be locked.`);
	}
	if (fromRoot === toRoot && fromIndex === toIndex) {
		return {
			changed: false,
			clientId: input.clientId,
			name: block.name,
			rootClientId: toRoot,
			index: toIndex,
			previousRootClientId: fromRoot,
			previousIndex: fromIndex,
		};
	}
	const actions = requireEditorActions();
	try {
		await actions.moveBlocksToPosition([input.clientId], fromRoot, toRoot, toIndex);
	} catch (error) {
		throw markAbilityMutationError(error);
	}
	const actual = store.getBlock(input.clientId);
	const actualRoot = actual ? rootOf(store, input.clientId) : "";
	const actualIndex = actual ? indexOf(store, input.clientId, actualRoot) : -1;
	if (!actual || actualRoot !== toRoot || actualIndex !== toIndex) {
		throw markAbilityMutationError(
			new Error("The editor did not move this block. It or its parent may be locked.")
		);
	}
	return {
		changed: true,
		clientId: input.clientId,
		name: block.name,
		rootClientId: actualRoot,
		index: actualIndex,
		previousRootClientId: fromRoot,
		previousIndex: fromIndex,
	};
}

async function removeBlock(input = {}) {
	const store = requireEditorStore();
	const actions = requireEditorActions();
	const block = requireBlock(store, input.clientId);
	rejectSpecial(store, input.clientId, {
		tool: "blu-delete-block",
		arguments: { client_id: input.clientId },
	});
	if (
		store.canRemoveBlocks?.([input.clientId]) === false ||
		store.canRemoveBlock?.(input.clientId) === false
	) {
		throw new Error(`Block "${block.name}" cannot be removed. It or its parent may be locked.`);
	}
	const rootClientId = rootOf(store, input.clientId);
	const index = indexOf(store, input.clientId, rootClientId);
	try {
		if (actions.removeBlocks) {
			await actions.removeBlocks([input.clientId], false);
		} else {
			await actions.removeBlock(input.clientId, false);
		}
	} catch (error) {
		throw markAbilityMutationError(error);
	}
	if (store.getBlock(input.clientId)) {
		throw markAbilityMutationError(
			new Error("The editor did not remove this block. It or its parent may be locked.")
		);
	}
	return {
		changed: true,
		clientId: input.clientId,
		name: block.name,
		rootClientId,
		index,
		removedInnerBlockCount: block.innerBlocks?.length || 0,
	};
}

async function transformBlock(input = {}) {
	const store = requireEditorStore();
	const block = requireBlock(store, input.clientId);
	rejectSpecial(store, input.clientId);
	getBlockType(input.name);
	if (block.name === input.name) {
		const rootClientId = rootOf(store, input.clientId);
		const index = indexOf(store, input.clientId, rootClientId);
		return {
			changed: false,
			previousClientId: input.clientId,
			previousName: block.name,
			name: input.name,
			clientIds: [input.clientId],
			blocks: [block],
			count: 1,
			rootClientId,
			index,
			indexes: [index],
		};
	}
	const api = requireBlocksApi();
	if (typeof api.switchToBlockType !== "function") {
		throw new Error("Block transforms are not available.");
	}
	const possible = api.getPossibleBlockTransformations?.([block]) || [];
	if (possible.length && !possible.some(({ name }) => name === input.name)) {
		throw new Error(`"${block.name}" cannot be transformed into "${input.name}".`);
	}
	const transformed = api.switchToBlockType(block, input.name) || [];
	if (!transformed.length) {
		throw new Error(`"${block.name}" cannot be transformed into "${input.name}".`);
	}
	const rootClientId = rootOf(store, input.clientId);
	const previousIndex = indexOf(store, input.clientId, rootClientId);
	if (
		store.canRemoveBlocks?.([input.clientId]) === false ||
		store.canRemoveBlock?.(input.clientId) === false
	) {
		throw new Error(`Block "${block.name}" cannot be transformed. It or its parent may be locked.`);
	}
	transformed.forEach(({ name }) => {
		assertDestinationNesting(store, name, rootClientId);
		assertCanInsert(store, name, rootClientId);
	});
	const actions = requireEditorActions();
	try {
		await actions.replaceBlocks([input.clientId], transformed);
	} catch (error) {
		throw markAbilityMutationError(error);
	}
	const actual = transformed.map(({ clientId }) => store.getBlock(clientId));
	if (store.getBlock(input.clientId) || actual.some((item) => !item)) {
		throw markAbilityMutationError(
			new Error("The editor did not transform this block. It or its parent may be locked.")
		);
	}
	const indexes = transformed.map(({ clientId }) => indexOf(store, clientId, rootClientId));
	return {
		changed: true,
		previousClientId: input.clientId,
		previousName: block.name,
		name: input.name,
		clientIds: transformed.map(({ clientId }) => clientId),
		blocks: actual,
		count: actual.length,
		rootClientId,
		index: indexes[0] ?? previousIndex,
		indexes,
	};
}

export function registerBlockStructureAbilities(register) {
	const blockSpec = {
		type: "object",
		properties: {
			name: { type: "string" },
			attributes: { type: "object" },
			innerBlocks: { type: "array", items: { type: "object" } },
		},
		required: ["name"],
	};
	const destinationProperties = {
		rootClientId: { type: "string" },
		index: { type: "integer", minimum: 0 },
	};
	const commonLocation = {
		changed: { type: "boolean" },
		clientId: { type: "string" },
		name: { type: "string" },
		rootClientId: { type: "string" },
		index: { type: "integer" },
	};
	const outputSchema = (properties) => ({
		type: "object",
		properties,
		required: Object.keys(properties),
		additionalProperties: false,
	});
	const base = { category: "blu-editor" };
	const definitions = [
		{
			...base,
			output_schema: outputSchema({
				changed: { type: "boolean" },
				clientId: { type: "string" },
				clientIds: { type: "array", items: { type: "string" } },
				name: { type: "string" },
				rootClientId: { type: "string" },
				index: { type: "integer" },
				innerBlockCount: { type: "integer" },
			}),
			name: "blu-editor/insert-block",
			label: "Insert Block",
			description: "Inserts a block and optional nested blocks.",
			input_schema: {
				...blockSpec,
				properties: {
					...blockSpec.properties,
					...destinationProperties,
					afterClientId: { type: "string" },
				},
				additionalProperties: false,
			},
			meta: WRITE_META(),
			callback: insertBlock,
		},
		{
			...base,
			output_schema: outputSchema({
				...commonLocation,
				previousRootClientId: { type: "string" },
				previousIndex: { type: "integer" },
			}),
			name: "blu-editor/move-block",
			label: "Move Block",
			description: "Moves a block to a validated editor location.",
			input_schema: {
				type: "object",
				properties: {
					clientId: { type: "string" },
					...destinationProperties,
					afterClientId: { type: "string" },
					beforeClientId: { type: "string" },
				},
				required: ["clientId"],
				additionalProperties: false,
			},
			meta: WRITE_META(false, true),
			callback: moveBlock,
		},
		{
			...base,
			output_schema: outputSchema({
				...commonLocation,
				removedInnerBlockCount: { type: "integer" },
			}),
			name: "blu-editor/remove-block",
			label: "Remove Block",
			description: "Removes a block and its descendants.",
			input_schema: {
				type: "object",
				properties: { clientId: { type: "string" } },
				required: ["clientId"],
				additionalProperties: false,
			},
			meta: WRITE_META(true, true),
			callback: removeBlock,
		},
		{
			...base,
			output_schema: outputSchema({
				changed: { type: "boolean" },
				previousClientId: { type: "string" },
				previousName: { type: "string" },
				name: { type: "string" },
				clientIds: { type: "array", items: { type: "string" } },
				blocks: { type: "array", items: { type: "object" } },
				count: { type: "integer" },
				rootClientId: { type: "string" },
				index: { type: "integer" },
				indexes: { type: "array", items: { type: "integer" } },
			}),
			name: "blu-editor/transform-block",
			label: "Transform Block",
			description: "Transforms a block into another registered block type.",
			input_schema: {
				type: "object",
				properties: { clientId: { type: "string" }, name: { type: "string" } },
				required: ["clientId", "name"],
				additionalProperties: false,
			},
			meta: WRITE_META(true),
			callback: transformBlock,
		},
	];
	return definitions.filter((definition) => register(definition)).map(({ name }) => name);
}
