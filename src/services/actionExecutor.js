/**
 * WordPress dependencies
 */
import { dispatch, select } from "@wordpress/data";
import { createBlock } from "@wordpress/blocks";

/**
 * Simple Action Executor
 *
 * Executes actions received from the AI chat API.
 * Supports the following operation types:
 * - update: Modify existing block attributes
 * - delete: Remove blocks from the editor
 */
class ActionExecutor {
	/**
	 * Execute actions array
	 *
	 * @param {Array} actions Array of actions to execute
	 * @return {Promise<Object>} Result of action execution
	 */
	async executeActions(actions) {
		if (!actions || !Array.isArray(actions)) {
			return { success: true, message: "No actions to execute" };
		}

		const results = [];
		const errors = [];

		for (const action of actions) {
			if (!action.operations || !Array.isArray(action.operations)) {
				continue;
			}

			// Sort operations by order
			const sortedOperations = [...action.operations].sort((a, b) => {
				return (a.order || 0) - (b.order || 0);
			});

			for (const operation of sortedOperations) {
				try {
					const result = await this.executeOperation(operation);
					results.push(result);
				} catch (error) {
					errors.push(error.message);
					// eslint-disable-next-line no-console
					console.error("Operation failed:", error);
				}
			}
		}

		return {
			success: errors.length === 0,
			message: errors.length === 0 ? "All actions executed successfully" : "Some actions failed",
			results,
			errors,
		};
	}

	/**
	 * Execute a single operation
	 *
	 * @param {Object} operation The operation to execute
	 * @return {Promise<Object>} Result of operation execution
	 */
	async executeOperation(operation) {
		if (operation.type === "update") {
			return this.handleUpdateOperation(operation);
		}

		if (operation.type === "delete") {
			return this.handleDeleteOperation(operation);
		}

		if (operation.type === "insert") {
			return this.handleInsertOperation(operation);
		}

		if (operation.type === "move") {
			return this.handleMoveOperation(operation);
		}

		throw new Error(`Unsupported operation type: ${operation.type}`);
	}

	/**
	 * Handle update operation
	 *
	 * @param {Object} operation The operation data
	 * @return {Promise<Object>} Result of the operation
	 */
	async handleUpdateOperation(operation) {
		const { clientId, block } = operation;

		if (!clientId) {
			throw new Error("Update operation requires clientId");
		}

		if (!block || !block.attributes) {
			throw new Error("Update operation requires block data with attributes");
		}

		// Check if block exists
		const { getBlock } = select("core/block-editor");
		const currentBlock = getBlock(clientId);

		if (!currentBlock) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		// Update the block attributes
		const { updateBlockAttributes } = dispatch("core/block-editor");
		updateBlockAttributes(clientId, block.attributes);

		// eslint-disable-next-line no-console
		console.log(`Updated block ${clientId} (${block.name})`, block.attributes);

		return {
			type: "update",
			clientId,
			blockName: block.name,
			message: `Block ${block.name} updated successfully`,
		};
	}

	/**
	 * Handle delete operation
	 *
	 * @param {Object} operation The operation data
	 * @return {Promise<Object>} Result of the operation
	 */
	async handleDeleteOperation(operation) {
		const { clientId } = operation;

		if (!clientId) {
			throw new Error("Delete operation requires clientId");
		}

		// Check if block exists
		const { getBlock } = select("core/block-editor");
		const blockToDelete = getBlock(clientId);

		if (!blockToDelete) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		// Delete the block
		const { removeBlock } = dispatch("core/block-editor");
		removeBlock(clientId);

		// eslint-disable-next-line no-console
		console.log(`Deleted block ${clientId} (${blockToDelete.name})`);

		return {
			type: "delete",
			clientId,
			blockName: blockToDelete.name,
			message: `Block ${blockToDelete.name} deleted successfully`,
		};
	}

	/**
	 * Handle insert operation
	 *
	 * @param {Object} operation The operation data
	 * @return {Promise<Object>} Result of the operation
	 */
	async handleInsertOperation(operation) {
		const { block, insertLocation } = operation;

		if (!block || !block.name) {
			throw new Error("Insert operation requires a block with a valid name");
		}

		if (
			!insertLocation ||
			!insertLocation.parentClientId ||
			typeof insertLocation.index !== "number"
		) {
			throw new Error(
				"Insert operation requires insertLocation with parentClientId and numeric index"
			);
		}

		const { parentClientId, index } = insertLocation;

		// Validate parent exists
		const { getBlock, getBlockOrder } = select("core/block-editor");
		const parentBlock = getBlock(parentClientId);

		if (!parentBlock) {
			throw new Error(`Parent block with clientId ${parentClientId} not found`);
		}

		const currentChildrenCount = Array.isArray(parentBlock.innerBlocks)
			? parentBlock.innerBlocks.length
			: 0;
		const targetIndex = Math.max(0, Math.min(index, currentChildrenCount));

		// Snapshot order before insert to help identify new clientId after insertion
		const beforeOrder = getBlockOrder(parentClientId);

		// Create and insert the new block
		const newBlock = createBlock(block.name, block.attributes || {}, block.innerBlocks || []);
		const { insertBlocks } = dispatch("core/block-editor");
		insertBlocks([newBlock], targetIndex, parentClientId);

		// Try to resolve the newly created clientId
		let newClientId = null;
		try {
			const afterOrder = getBlockOrder(parentClientId);
			// Prefer the id at the target index; fallback to diff
			newClientId =
				afterOrder[targetIndex] || afterOrder.find((id) => !beforeOrder.includes(id)) || null;
		} catch (_) {
			// ignore
		}

		// eslint-disable-next-line no-console
		console.log(
			`Inserted block ${block.name} at index ${targetIndex} under parent ${parentClientId}`,
			{ clientId: newClientId }
		);

		return {
			type: "insert",
			clientId: newClientId,
			blockName: block.name,
			parentClientId,
			index: targetIndex,
			message: `Block ${block.name} inserted successfully`,
		};
	}

	/**
	 * Handle move operation
	 *
	 * @param {Object} operation The operation data
	 * @return {Promise<Object>} Result of the operation
	 */
	async handleMoveOperation(operation) {
		const { clientId, moveLocation } = operation;

		if (!clientId) {
			throw new Error("Move operation requires clientId");
		}

		if (!moveLocation || !moveLocation.parentClientId || typeof moveLocation.index !== "number") {
			throw new Error("Move operation requires moveLocation with parentClientId and numeric index");
		}

		const { parentClientId, index } = moveLocation;

		// Validate source block and destination parent
		const { getBlock, getBlockRootClientId, getBlockOrder } = select("core/block-editor");
		const blockToMove = getBlock(clientId);
		if (!blockToMove) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		const destinationParent = getBlock(parentClientId);
		if (!destinationParent) {
			throw new Error(`Destination parent block ${parentClientId} not found`);
		}

		const currentChildrenCount = Array.isArray(destinationParent.innerBlocks)
			? destinationParent.innerBlocks.length
			: 0;
		const targetIndex = Math.max(0, Math.min(index, currentChildrenCount));

		// Resolve source (from) parent/root id
		const fromRootClientId = getBlockRootClientId(clientId);
		const toRootClientId = parentClientId;

		const { moveBlockToPosition } = dispatch("core/block-editor");
		moveBlockToPosition(clientId, fromRootClientId, toRootClientId, targetIndex);

		let newIndex = targetIndex;
		try {
			const afterOrder = getBlockOrder(toRootClientId);
			newIndex = afterOrder.indexOf(clientId);
			if (newIndex === -1) {
				newIndex = targetIndex;
			}
		} catch (_) {
			// ignore
		}

		// eslint-disable-next-line no-console
		// console.log(`Moved block ${clientId} to index ${newIndex} under parent ${toRootClientId}`, { before: beforeOrder });

		return {
			type: "move",
			clientId,
			parentClientId: toRootClientId,
			index: newIndex,
			message: `Block moved successfully`,
		};
	}
}

// Create and export a singleton instance
const actionExecutor = new ActionExecutor();
export default actionExecutor;
