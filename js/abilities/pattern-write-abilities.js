import {
	assertBlockCanInsertAtDestination,
	assertSafeBlockMutationTarget,
	buildBlock,
	resolveBlockInsertRoot,
} from "./block-structure-abilities";
import { requireBlock, requireEditorActions, requireEditorStore } from "./editor-store";
import {
	assertCanCreatePatterns,
	countPatternBlocks,
	parsePatternContent,
	PATTERN_POST_TYPE,
	requireCoreActions,
	requirePattern,
	resolvePatternCategoryIds,
	USER_PATTERN_PREFIX,
} from "./pattern-store";

const WRITE_META = (destructive = false) => ({
	annotations: { readonly: false, destructive, idempotent: false },
});

function validateIndex(index) {
	if (index !== undefined && (!Number.isInteger(index) || index < 0)) {
		throw new Error("index must be an integer zero or greater.");
	}
}

function rootOf(store, clientId) {
	return store.getBlockRootClientId?.(clientId) || "";
}

function buildValidatedPatternBlocks(pattern, asReference) {
	if (asReference) {
		if (!pattern.isUserPattern || !pattern.id) {
			throw new Error(
				`Pattern "${pattern.name}" is not a user pattern and cannot be inserted as a reference.`
			);
		}
		return [buildBlock({ name: "core/block", attributes: { ref: pattern.id } }, "pattern")];
	}
	const parsed = parsePatternContent(pattern);
	if (!parsed.length) {
		throw new Error(`Pattern "${pattern.name}" contains no blocks.`);
	}
	return parsed.map((block, index) =>
		buildBlock(
			{
				name: block.name,
				attributes: block.attributes ?? {},
				innerBlocks: block.innerBlocks ?? [],
			},
			`pattern.blocks[${index}]`
		)
	);
}

function validateDestination(store, blocks, rootClientId) {
	for (const block of blocks) {
		assertBlockCanInsertAtDestination(store, block.name, rootClientId);
	}
}

async function insertPattern(input = {}) {
	const store = requireEditorStore();
	const actions = requireEditorActions();
	validateIndex(input.index);
	const hasRoot = Object.prototype.hasOwnProperty.call(input, "rootClientId");
	const hasAfter = Object.prototype.hasOwnProperty.call(input, "afterClientId");
	if (hasRoot && input.rootClientId) {
		requireBlock(store, input.rootClientId, "rootClientId");
	}

	let rootClientId = input.rootClientId || "";
	let index = input.index;
	if (hasAfter) {
		requireBlock(store, input.afterClientId, "afterClientId");
		const siblingRoot = rootOf(store, input.afterClientId);
		if (input.rootClientId && siblingRoot !== input.rootClientId) {
			throw new Error("afterClientId is not a child of the provided rootClientId.");
		}
		rootClientId = siblingRoot;
		index = store.getBlockIndex(input.afterClientId, siblingRoot) + 1;
	}

	const pattern = await requirePattern(input.name);
	const asReference = input.asReference ?? pattern.syncStatus === "synced";
	const blocks = buildValidatedPatternBlocks(pattern, asReference);
	if (!hasAfter && !input.rootClientId) {
		rootClientId = resolveBlockInsertRoot(store, blocks[0].name);
	}
	validateDestination(store, blocks, rootClientId);
	const order = store.getBlockOrder?.(rootClientId) || [];
	const insertionIndex = index === undefined ? order.length : Math.min(index, order.length);

	await actions.insertBlocks(blocks, insertionIndex, rootClientId);
	const inserted = blocks.map(({ clientId }) => store.getBlock(clientId));
	if (inserted.some((block) => !block)) {
		throw new Error("The editor did not insert this pattern. Its destination may be locked.");
	}
	return {
		changed: true,
		patternName: pattern.name,
		patternId: pattern.id,
		title: pattern.title,
		asReference,
		clientIds: blocks.map(({ clientId }) => clientId),
		blocks: inserted,
		count: inserted.length,
		rootClientId,
		index: insertionIndex,
	};
}

function requireSiblingRange(store, clientIds) {
	if (new Set(clientIds).size !== clientIds.length) {
		throw new Error("clientIds must not contain duplicate blocks.");
	}
	const rootClientId = rootOf(store, clientIds[0]);
	const indexes = clientIds.map((clientId) => {
		if (rootOf(store, clientId) !== rootClientId) {
			throw new Error("replaceSource clientIds must be adjacent siblings.");
		}
		return store.getBlockIndex(clientId, rootClientId);
	});
	for (let index = 1; index < indexes.length; index++) {
		if (indexes[index] !== indexes[0] + index) {
			throw new Error("replaceSource clientIds must be adjacent siblings in document order.");
		}
	}
	return { clientIds: [...clientIds], rootClientId, index: indexes[0] };
}

async function createPattern(input = {}) {
	if (typeof input.title !== "string" || !input.title.trim()) {
		throw new Error("title must be a name for the pattern.");
	}
	const hasClientIds = Array.isArray(input.clientIds) && input.clientIds.length > 0;
	const hasBlocks = Array.isArray(input.blocks) && input.blocks.length > 0;
	if (hasClientIds === hasBlocks) {
		throw new Error("Pass either clientIds or blocks, but not both.");
	}
	const syncStatus = input.syncStatus ?? "unsynced";
	if (!["synced", "unsynced"].includes(syncStatus)) {
		throw new Error("syncStatus must be either synced or unsynced.");
	}
	if (input.replaceSource && (!hasClientIds || syncStatus !== "synced")) {
		throw new Error("replaceSource requires clientIds and a synced pattern.");
	}

	const store = requireEditorStore();
	let sourceBlocks;
	let siblingRange = null;
	if (hasClientIds) {
		sourceBlocks = input.clientIds.map((clientId) => requireBlock(store, clientId, "clientId"));
		if (input.replaceSource) {
			input.clientIds.forEach((clientId) => assertSafeBlockMutationTarget(store, clientId));
			siblingRange = requireSiblingRange(store, input.clientIds);
			if (
				store.canRemoveBlocks?.(siblingRange.clientIds) === false ||
				store.canRemoveBlock?.(siblingRange.clientIds[0]) === false
			) {
				throw new Error("The source blocks cannot be replaced. They may be locked.");
			}
			const probe = buildBlock({ name: "core/block", attributes: { ref: 0 } }, "reference");
			assertBlockCanInsertAtDestination(store, probe.name, siblingRange.rootClientId);
		}
	} else {
		sourceBlocks = input.blocks.map((block, index) => buildBlock(block, `blocks[${index}]`));
	}

	if (input.categories !== undefined && !Array.isArray(input.categories)) {
		throw new Error("categories must be a list of pattern category names.");
	}
	for (const category of input.categories || []) {
		if (typeof category !== "string" || !category.trim()) {
			throw new Error("categories must be a list of pattern category names.");
		}
	}
	const serialize = window.wp?.blocks?.serialize;
	if (typeof serialize !== "function") {
		throw new Error("WordPress block serialization is not available.");
	}
	await assertCanCreatePatterns();
	const { ids, slugs, created } = await resolvePatternCategoryIds(input.categories);
	const record = await requireCoreActions().saveEntityRecord(
		"postType",
		PATTERN_POST_TYPE,
		{
			title: input.title.trim(),
			content: serialize(sourceBlocks),
			status: "publish",
			meta: syncStatus === "unsynced" ? { wp_pattern_sync_status: "unsynced" } : undefined,
			wp_pattern_category: ids,
		},
		{ throwOnError: true }
	);
	if (!record?.id) {
		throw new Error("WordPress did not save this pattern.");
	}

	const result = {
		changed: true,
		id: record.id,
		name: `${USER_PATTERN_PREFIX}${record.id}`,
		title: input.title.trim(),
		syncStatus,
		categories: slugs,
		createdCategories: created,
		blockCount: countPatternBlocks(sourceBlocks),
		replacedClientIds: null,
		clientId: null,
	};
	if (siblingRange) {
		const reference = buildBlock(
			{ name: "core/block", attributes: { ref: record.id } },
			"reference"
		);
		const actions = requireEditorActions();
		await actions.replaceBlocks(siblingRange.clientIds, [reference]);
		if (!store.getBlock(reference.clientId)) {
			throw new Error(
				`The pattern was saved as ${result.name}, but the editor did not replace the original blocks.`
			);
		}
		result.replacedClientIds = siblingRange.clientIds;
		result.clientId = reference.clientId;
	}
	return result;
}

export function registerPatternWriteAbilities(register) {
	const blockSpec = {
		type: "object",
		properties: {
			name: { type: "string" },
			attributes: { type: "object" },
			innerBlocks: { type: "array", items: { type: "object" } },
		},
		required: ["name"],
	};
	const definitions = [
		{
			name: "blu-editor/insert-pattern",
			label: "Insert Pattern",
			description: "Inserts a registered or user-created pattern at a validated location.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					name: { type: "string" },
					rootClientId: { type: "string" },
					index: { type: "integer", minimum: 0 },
					afterClientId: { type: "string" },
					asReference: { type: "boolean" },
				},
				required: ["name"],
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					changed: { type: "boolean" },
					patternName: { type: "string" },
					patternId: { type: ["integer", "null"] },
					title: { type: "string" },
					asReference: { type: "boolean" },
					clientIds: { type: "array", items: { type: "string" } },
					blocks: { type: "array" },
					count: { type: "integer" },
					rootClientId: { type: "string" },
					index: { type: "integer" },
				},
				required: ["changed", "patternName", "asReference", "clientIds", "count"],
			},
			meta: WRITE_META(),
			callback: insertPattern,
		},
		{
			name: "blu-editor/create-pattern",
			label: "Create Pattern",
			description: "Saves existing or supplied blocks as a synced or unsynced pattern.",
			category: "blu-editor",
			input_schema: {
				type: "object",
				properties: {
					title: { type: "string" },
					clientIds: { type: "array", items: { type: "string" } },
					blocks: { type: "array", items: blockSpec },
					syncStatus: { type: "string", enum: ["synced", "unsynced"] },
					categories: { type: "array", items: { type: "string" } },
					replaceSource: { type: "boolean" },
				},
				required: ["title"],
				additionalProperties: false,
			},
			output_schema: {
				type: "object",
				properties: {
					changed: { type: "boolean" },
					id: { type: "integer" },
					name: { type: "string" },
					title: { type: "string" },
					syncStatus: { type: "string", enum: ["synced", "unsynced"] },
					categories: { type: "array", items: { type: "string" } },
					createdCategories: { type: "array", items: { type: "string" } },
					blockCount: { type: "integer" },
					replacedClientIds: { type: ["array", "null"] },
					clientId: { type: ["string", "null"] },
				},
				required: ["changed", "id", "name", "title", "syncStatus", "blockCount"],
			},
			meta: WRITE_META(true),
			callback: createPattern,
		},
	];
	return definitions.filter((definition) => register(definition)).map(({ name }) => name);
}
