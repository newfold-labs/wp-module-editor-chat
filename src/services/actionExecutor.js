/**
 * WordPress dependencies
 */
import { dispatch, select } from "@wordpress/data";

/**
 * Simple Action Executor
 *
 * Executes actions received from the AI chat API.
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
}

// Create and export a singleton instance
const actionExecutor = new ActionExecutor();
export default actionExecutor;
