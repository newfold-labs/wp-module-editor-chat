import { markAbilityMutationError } from "./ability-errors.js";

export const CORE_STORE = "core";
export const PATTERN_POST_TYPE = "wp_block";
export const PATTERN_TAXONOMY = "wp_pattern_category";
export const USER_PATTERN_PREFIX = "core/block/";

function requireCoreStore() {
	const data = window.wp?.data;
	const resolveSelect = data?.resolveSelect;
	const select = data?.select;
	if (typeof resolveSelect === "function") {
		return resolveSelect(CORE_STORE);
	}
	if (typeof select === "function") {
		return select(CORE_STORE);
	}
	throw new Error("WordPress data store is not available.");
}

export function requireCoreActions() {
	const dispatch = window.wp?.data?.dispatch;
	if (typeof dispatch !== "function") {
		throw new Error("WordPress data store is not available.");
	}
	const actions = dispatch(CORE_STORE);
	if (!actions) {
		throw new Error("WordPress core data actions are not available.");
	}
	return actions;
}

export async function loadRegisteredPatterns() {
	const core = requireCoreStore();
	return typeof core?.getBlockPatterns === "function" ? (await core.getBlockPatterns()) || [] : [];
}

export async function loadUserPatternRecords() {
	const core = requireCoreStore();
	if (typeof core?.getEntityRecords !== "function") {
		return [];
	}
	try {
		return (
			(await core.getEntityRecords("postType", PATTERN_POST_TYPE, {
				per_page: -1,
				context: "edit",
			})) || []
		);
	} catch {
		return [];
	}
}

export async function loadPatternCategoryTerms() {
	const core = requireCoreStore();
	if (typeof core?.getEntityRecords !== "function") {
		return [];
	}
	try {
		return (
			(await core.getEntityRecords("taxonomy", PATTERN_TAXONOMY, {
				per_page: -1,
				hide_empty: false,
			})) || []
		);
	} catch {
		return [];
	}
}

export function normalizeRegisteredPattern(pattern) {
	return {
		name: pattern.name,
		title: pattern.title ?? pattern.name,
		description: pattern.description ?? "",
		source: pattern.source ?? null,
		isUserPattern: false,
		id: null,
		syncStatus: null,
		categories: pattern.categories ?? [],
		blockTypes: pattern.blockTypes ?? [],
		inserter: pattern.inserter !== false,
		content: pattern.content ?? "",
	};
}

export function normalizeUserPattern(record, categorySlugsById) {
	const syncStatus = record.wp_pattern_sync_status ?? record.meta?.wp_pattern_sync_status ?? "";
	return {
		name: `${USER_PATTERN_PREFIX}${record.id}`,
		title: record.title?.raw ?? record.title?.rendered ?? "",
		description: "",
		source: "user",
		isUserPattern: true,
		id: record.id,
		syncStatus: syncStatus === "unsynced" ? "unsynced" : "synced",
		categories: (record.wp_pattern_category ?? []).map(
			(termId) => categorySlugsById.get(termId) ?? String(termId)
		),
		blockTypes: [],
		inserter: true,
		content: record.content?.raw ?? record.content?.rendered ?? "",
	};
}

export async function loadPatterns() {
	const [registered, records, terms] = await Promise.all([
		loadRegisteredPatterns(),
		loadUserPatternRecords(),
		loadPatternCategoryTerms(),
	]);
	const categorySlugsById = new Map(terms.map((term) => [term.id, term.slug]));
	return [
		...records.map((record) => normalizeUserPattern(record, categorySlugsById)),
		...registered.map(normalizeRegisteredPattern),
	];
}

export function parsePatternContent(pattern) {
	const parse = window.wp?.blocks?.parse;
	if (typeof parse !== "function") {
		throw new Error("WordPress block parser is not available.");
	}
	return parse(pattern.content || "") || [];
}

export function countPatternBlocks(blocks) {
	return blocks.reduce(
		(count, block) => count + 1 + countPatternBlocks(block.innerBlocks || []),
		0
	);
}

export function serializePatternBlock(block, maxDepth = Infinity, depth = 0) {
	const innerBlocks = block.innerBlocks || [];
	const node = {
		name: block.name,
		attributes: block.attributes ?? {},
	};
	if (depth >= maxDepth) {
		node.innerBlocks = [];
		node.truncatedInnerBlockCount = innerBlocks.length;
		return node;
	}
	node.innerBlocks = innerBlocks.map((innerBlock) =>
		serializePatternBlock(innerBlock, maxDepth, depth + 1)
	);
	return node;
}

const patternStructureCache = new Map();

export function getPatternStructure(pattern) {
	const cached = patternStructureCache.get(pattern.name);
	if (cached?.content === pattern.content) {
		return cached.structure;
	}
	const blocks = parsePatternContent(pattern);
	const structure = {
		blockCount: countPatternBlocks(blocks),
		rootBlockNames: blocks.map((block) => block.name),
	};
	patternStructureCache.set(pattern.name, { content: pattern.content, structure });
	return structure;
}

export function summarizePattern(pattern) {
	const structure = getPatternStructure(pattern);
	const summary = {
		name: pattern.name,
		title: pattern.title,
		description: pattern.description,
		source: pattern.source,
		isUserPattern: pattern.isUserPattern,
		syncStatus: pattern.syncStatus,
		categories: pattern.categories,
		...structure,
	};
	if (pattern.blockTypes.length) {
		summary.blockTypes = pattern.blockTypes;
	}
	return summary;
}

export async function requirePattern(name) {
	const patterns = await loadPatterns();
	const pattern = patterns.find((candidate) => candidate.name === name);
	if (!pattern) {
		throw new Error(`Unknown pattern "${name ?? ""}"`);
	}
	return pattern;
}

export async function listPatternCategories() {
	const core = requireCoreStore();
	const [registered, terms] = await Promise.all([
		typeof core?.getBlockPatternCategories === "function"
			? (await core.getBlockPatternCategories()) || []
			: [],
		loadPatternCategoryTerms(),
	]);
	const bySlug = new Map();
	for (const category of registered) {
		bySlug.set(category.name, {
			name: category.name,
			label: category.label ?? category.name,
			description: category.description ?? "",
			id: null,
			registered: true,
		});
	}
	for (const term of terms) {
		const existing = bySlug.get(term.slug);
		bySlug.set(term.slug, {
			name: term.slug,
			label: term.name ?? existing?.label ?? term.slug,
			description: term.description ?? existing?.description ?? "",
			id: term.id,
			registered: existing?.registered ?? false,
		});
	}
	return [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function assertCanCreatePatterns() {
	const core = requireCoreStore();
	if (typeof core?.canUser !== "function") {
		throw new Error("Pattern creation permission could not be confirmed on this screen.");
	}
	let allowed;
	try {
		allowed = await core.canUser("create", {
			kind: "postType",
			name: PATTERN_POST_TYPE,
		});
	} catch {
		throw new Error("Pattern creation permission could not be confirmed on this screen.");
	}
	if (allowed !== true) {
		throw new Error("This account is not allowed to create patterns on this site.");
	}
}

export async function resolvePatternCategoryIds(names = []) {
	if (!Array.isArray(names)) {
		throw new Error("categories must be a list of pattern category names.");
	}
	for (const name of names) {
		if (typeof name !== "string" || !name.trim()) {
			throw new Error("categories must be a list of pattern category names.");
		}
	}
	if (!names.length) {
		return { ids: [], slugs: [], created: [], createdRecords: [] };
	}

	const categories = await listPatternCategories();
	const actions = requireCoreActions();
	const ids = [];
	const slugs = [];
	const created = [];
	const createdRecords = [];
	try {
		for (const requested of names) {
			const needle = requested.toLowerCase();
			const match = categories.find(
				(category) =>
					category.name.toLowerCase() === needle || category.label.toLowerCase() === needle
			);
			if (match?.id) {
				ids.push(match.id);
				slugs.push(match.name);
				continue;
			}
			const slug = match?.name ?? requested;
			const term = await actions.saveEntityRecord(
				"taxonomy",
				PATTERN_TAXONOMY,
				{ name: match?.label ?? requested, slug },
				{ throwOnError: true }
			);
			if (!term?.id) {
				throw new Error(`Could not create the pattern category "${requested}".`);
			}
			ids.push(term.id);
			slugs.push(term.slug ?? slug);
			created.push(term.slug ?? slug);
			createdRecords.push({ id: term.id, slug: term.slug ?? slug });
		}
	} catch (error) {
		const cleanupErrors = [];
		for (const record of createdRecords.reverse()) {
			try {
				if (typeof actions.deleteEntityRecord !== "function") {
					throw new Error(`Could not remove category "${record.slug}".`);
				}
				await actions.deleteEntityRecord("taxonomy", PATTERN_TAXONOMY, record.id, {
					throwOnError: true,
				});
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		throw markAbilityMutationError(error, cleanupErrors);
	}
	return { ids, slugs, created, createdRecords };
}
