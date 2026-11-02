const BLOCK_EDITOR_STORE = "core/block-editor";

/**
 * Return the live block-editor selectors without touching wp.data at import time.
 *
 * @return {Object} Block-editor selectors.
 */
export function requireEditorStore() {
	const select = window.wp?.data?.select;
	if (typeof select !== "function") {
		throw new Error(
			"WordPress data store is not available. Open this ability in the block editor."
		);
	}

	const store = select(BLOCK_EDITOR_STORE);
	if (!store) {
		throw new Error(
			"Block editor store is not available. These abilities only work in the block editor."
		);
	}
	return store;
}

/**
 * Return the live block-editor actions without touching wp.data at import time.
 *
 * @return {Object} Block-editor actions.
 */
export function requireEditorActions() {
	const dispatch = window.wp?.data?.dispatch;
	if (typeof dispatch !== "function") {
		throw new Error(
			"WordPress data store is not available. Open this ability in the block editor."
		);
	}
	const actions = dispatch(BLOCK_EDITOR_STORE);
	if (!actions) {
		throw new Error(
			"Block editor actions are not available. These abilities only work in the block editor."
		);
	}
	return actions;
}

/**
 * Resolve a client ID before passing it to selectors that interpret an empty
 * value as the document root.
 *
 * @param {Object} store    Block-editor selectors.
 * @param {string} clientId Client ID to resolve.
 * @param {string} label    Input field name for errors.
 * @return {Object} Resolved block.
 */
export function requireBlock(store, clientId, label = "clientId") {
	const block = typeof clientId === "string" && clientId ? store.getBlock(clientId) : null;
	if (!block) {
		throw new Error(`Unknown ${label} "${clientId ?? ""}"`);
	}
	return block;
}

/**
 * Read ordinary or controlled inner blocks.
 *
 * @param {Object} store Block-editor selectors.
 * @param {Object} block Current block.
 * @return {{ innerBlocks: Object[], controlled: boolean }} Inner blocks.
 */
export function getInnerBlocks(store, block) {
	if (store.areInnerBlocksControlled?.(block.clientId)) {
		return {
			innerBlocks: store.getBlocks(block.clientId) || [],
			controlled: true,
		};
	}
	return {
		innerBlocks: block.innerBlocks || [],
		controlled: false,
	};
}

/**
 * Add a controlled pattern reference to the current traversal path.
 *
 * @param {Object}       block       Current block.
 * @param {Set<unknown>} visitedRefs Controlled refs on the current path.
 * @return {?Set<unknown>} Child refs, or null when recursion repeats.
 */
export function withControlledRef(block, visitedRefs) {
	const ref = block.attributes?.ref;
	if (ref === undefined) {
		return visitedRefs;
	}
	if (visitedRefs.has(ref)) {
		return null;
	}
	return new Set(visitedRefs).add(ref);
}

/**
 * Serialize a block while guarding recursive controlled patterns.
 *
 * @param {Object}       store       Block-editor selectors.
 * @param {Object}       block       Current block.
 * @param {number}       maxDepth    Maximum descendant depth.
 * @param {number}       depth       Current depth.
 * @param {Set<unknown>} visitedRefs Controlled pattern refs on this path.
 * @return {Object} Serialized tree node.
 */
export function serializeBlock(
	store,
	block,
	maxDepth = Infinity,
	depth = 0,
	visitedRefs = new Set()
) {
	const { innerBlocks, controlled } = getInnerBlocks(store, block);
	const node = {
		clientId: block.clientId,
		name: block.name,
		attributes: block.attributes ?? {},
	};

	if (controlled) {
		node.controlledInnerBlocks = true;
	}

	const childRefs = controlled ? withControlledRef(block, visitedRefs) : visitedRefs;

	if (depth >= maxDepth || childRefs === null) {
		node.innerBlocks = [];
		node.truncatedInnerBlockCount = innerBlocks.length;
		return node;
	}

	node.innerBlocks = innerBlocks.map((innerBlock) =>
		serializeBlock(store, innerBlock, maxDepth, depth + 1, childRefs)
	);
	return node;
}
