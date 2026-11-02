const CORE_STORE = "core";
const PATTERN_POST_TYPE = "wp_block";
const PATTERN_TAXONOMY = "wp_pattern_category";
const USER_PATTERN_PREFIX = "core/block/";

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
