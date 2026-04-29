/* eslint-disable no-undef */
/**
 * Target resolver — deterministic kind → clientId resolution.
 *
 * Shared by every intent-based verb. Given {kind, scope?, position?}, returns
 * the clientId of the best-matching block — without any LLM involvement.
 *
 * Search scope precedence:
 *   1. If `scope` (a clientId) is given → search that block's subtree only.
 *   2. Else if there is a selected block → try each ancestor of the selection
 *      from nearest upward, and use the first ancestor that contains a match.
 *   3. Else → search the whole post tree.
 *
 * Why "ancestor walk" (#2): when the user selects a column and says "add another
 * column", the selection itself is a valid match. When the user selects the Stats
 * group and says "add another column", the scope walks up and finds columns inside.
 */
import { select } from "@wordpress/data";
import { BLOCK_LEXICON, normalizeKind, blockMatchesKind } from "../utils/blockLexicon";

/**
 * Walk a block subtree, pushing every block that matches `lexEntry` into `out`.
 * Depth-first, pre-order — so matches preserve the visual top-to-bottom order.
 */
function collectMatches(block, lexEntry, out) {
	if (!block) return;
	if (blockMatchesKind(block, lexEntry)) {
		out.push(block);
	}
	if (Array.isArray(block.innerBlocks)) {
		for (const child of block.innerBlocks) {
			collectMatches(child, lexEntry, out);
		}
	}
}

/**
 * Resolve {kind, scope?, position?} to a concrete target block.
 *
 * @param {Object} params
 * @param {string} params.kind     User-facing kind word ("column", "card", …).
 * @param {string} [params.scope]  Optional clientId bounding the search.
 * @param {string|number} [params.position]  "last" (default) | "first" | integer index.
 * @return {{client_id: string, parent_client_id: string|null, kind_matched: string, candidates: Array, why: string}}
 * @throws {Error} When the kind is unknown or no matching block is found. The error
 *   message lists available kinds or candidates so the caller can self-correct.
 */
export function resolveTarget({ kind, scope, position = "last" }) {
	const canonicalKind = normalizeKind(kind);
	if (!canonicalKind) {
		const known = Object.keys(BLOCK_LEXICON).join(", ");
		throw new Error(
			`Unknown kind "${kind}". Known kinds: ${known}. ` +
				`Use the "client_id" mode if you have a specific block's UUID instead.`
		);
	}
	const lexEntry = BLOCK_LEXICON[canonicalKind];

	const blockEditor = select("core/block-editor");

	// Build ordered list of search roots.
	const searchRoots = buildSearchRoots(scope, blockEditor);

	// Try each root in order; first root that produces matches wins.
	let matches = [];
	let matchedRootId = null;
	for (const root of searchRoots) {
		const found = [];
		collectMatches(root, lexEntry, found);
		if (found.length > 0) {
			matches = found;
			matchedRootId = root.clientId;
			break;
		}
	}

	if (matches.length === 0) {
		throw new Error(
			`No "${canonicalKind}" blocks (${lexEntry.names.join("|")}) found in the current scope. ` +
				`Either pass an explicit client_id, or widen the scope.`
		);
	}

	// Pick based on position.
	const picked = pickByPosition(matches, position);
	const parentClientId = blockEditor.getBlockRootClientId(picked.clientId) || null;

	return {
		client_id: picked.clientId,
		parent_client_id: parentClientId,
		kind_matched: canonicalKind,
		candidates: matches.map((b) => ({ client_id: b.clientId, name: b.name })),
		why:
			`kind="${canonicalKind}" resolved to ${picked.name} (id:${picked.clientId}) ` +
			`from ${matches.length} candidate(s) under root ${matchedRootId || "root"}; position=${position}`,
	};
}

/**
 * Ordered search roots: explicit scope → selection ancestors → whole tree.
 */
function buildSearchRoots(scope, blockEditor) {
	if (scope) {
		const block = blockEditor.getBlock(scope);
		if (block) return [block];
		// Fall through to defaults if scope isn't found — better UX than hard-failing.
	}

	const selectedId = blockEditor.getSelectedBlockClientId();
	if (selectedId) {
		// Walk up: selection itself, then each ancestor toward root.
		const roots = [];
		let currentId = selectedId;
		while (currentId) {
			const block = blockEditor.getBlock(currentId);
			if (block) roots.push(block);
			currentId = blockEditor.getBlockRootClientId(currentId);
			if (!currentId) break;
		}
		// Finally, the whole tree as a last resort.
		const topLevel = blockEditor.getBlocks();
		if (topLevel && topLevel.length > 0) {
			roots.push({ clientId: null, innerBlocks: topLevel });
		}
		return roots;
	}

	const topLevel = blockEditor.getBlocks() || [];
	return [{ clientId: null, innerBlocks: topLevel }];
}

/**
 * Pick one block from an ordered match list by position spec.
 */
function pickByPosition(matches, position) {
	if (position === "first") return matches[0];
	if (position === "last") return matches[matches.length - 1];
	if (typeof position === "number") {
		if (position < 0) return matches[Math.max(0, matches.length + position)];
		return matches[Math.min(position, matches.length - 1)];
	}
	// Unknown spec — default to last.
	return matches[matches.length - 1];
}
