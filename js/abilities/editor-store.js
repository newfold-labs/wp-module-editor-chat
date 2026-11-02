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

	let childRefs = visitedRefs;
	if (controlled && block.attributes?.ref !== undefined) {
		if (visitedRefs.has(block.attributes.ref)) {
			childRefs = null;
		} else {
			childRefs = new Set(visitedRefs);
			childRefs.add(block.attributes.ref);
		}
	}

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
