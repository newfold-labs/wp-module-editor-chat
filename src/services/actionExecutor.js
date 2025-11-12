/**
 * WordPress dependencies
 */
import { dispatch, select } from "@wordpress/data";
import { serialize, parse, createBlock } from "@wordpress/blocks";

/**
 * Internal dependencies
 */
import {
	updateTemplatePartContent,
	getTemplatePartEntity,
	isTemplatePart,
} from "../utils/editorHelpers";

/**
 * Simple Action Executor
 *
 * Executes actions received from the AI chat API.
 * Supports the following action types:
 * - edit_content: Apply find/replace changes to block content
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
			try {
				if (!action.action) {
					errors.push("Action missing 'action' property");
					continue;
				}

				const result = await this.executeAction(action);
				results.push(result);
			} catch (error) {
				errors.push(error.message);
				// eslint-disable-next-line no-console
				console.error("Action failed:", error);
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
	 * Execute a single action
	 *
	 * @param {Object} action The action to execute
	 * @return {Promise<Object>} Result of action execution
	 */
	async executeAction(action) {
		if (action.action === "edit_content") {
			return this.handleEditContentAction(action);
		}

		throw new Error(`Unsupported action type: ${action.action}`);
	}

	/**
	 * Handle edit_content action
	 *
	 * @param {Object} action The action data
	 * @return {Promise<Object>} Result of the action
	 */
	async handleEditContentAction(action) {
		const { data } = action;

		if (!data || !data.content || !Array.isArray(data.content)) {
			throw new Error("Edit content action requires data.content array");
		}

		const results = [];
		const errors = [];

		for (const contentItem of data.content) {
			// API uses snake_case, convert to camelCase
			const clientId = contentItem.client_id;
			const { changes } = contentItem;

			if (!clientId) {
				errors.push("Content item missing client_id");
				continue;
			}

			if (!changes || !Array.isArray(changes)) {
				errors.push(`Content item ${clientId} missing changes array`);
				continue;
			}

			try {
				const result = await this.applyContentChanges(clientId, changes);
				results.push(result);
			} catch (error) {
				errors.push(`Failed to apply changes to ${clientId}: ${error.message}`);
				// eslint-disable-next-line no-console
				console.error(`Failed to apply changes to block ${clientId}:`, error);
			}
		}

		return {
			type: "edit_content",
			success: errors.length === 0,
			message:
				errors.length === 0
					? "All content changes applied successfully"
					: "Some content changes failed",
			results,
			errors,
		};
	}

	/**
	 * Apply find/replace changes to a block's content
	 *
	 * @param {string} clientId The block's client ID
	 * @param {Array}  changes  Array of {find, replace} objects
	 * @return {Promise<Object>} Result of the changes
	 */
	async applyContentChanges(clientId, changes) {
		const { getBlock } = select("core/block-editor");
		const block = getBlock(clientId);

		if (!block) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		// Check if this is a template part - handle differently
		if (isTemplatePart(block)) {
			return this.applyTemplatePartChanges(clientId, block, changes);
		}

		// Save the original block state for undo
		const originalBlock = {
			clientId,
			name: block.name,
			attributes: { ...block.attributes },
			innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
		};

		// Serialize the block to HTML
		let blockHtml = serialize(block);

		// Apply all find/replace operations
		for (const change of changes) {
			const { find, replace } = change;

			if (typeof find !== "string" || typeof replace !== "string") {
				throw new Error("Change must have find and replace as strings");
			}

			// Normalize both strings to handle whitespace/newline differences
			const normalizedBlockHtml = this.normalizeHtml(blockHtml);
			const normalizedFind = this.normalizeHtml(find);
			const normalizedReplace = this.normalizeHtml(replace);

			// eslint-disable-next-line no-console
			console.log({
				blockHtml: normalizedBlockHtml,
				find: normalizedFind,
				replace: normalizedReplace,
			});

			// Perform the replacement on normalized strings
			if (normalizedBlockHtml.includes(normalizedFind)) {
				// Replace in the normalized version
				blockHtml = normalizedBlockHtml.replace(normalizedFind, normalizedReplace);
			} else {
				// eslint-disable-next-line no-console
				console.warn(`Find string not found in block ${clientId}:`, find.substring(0, 50));
			}
		}

		// Parse the updated HTML back into blocks
		const updatedBlocks = parse(blockHtml);

		if (!updatedBlocks || updatedBlocks.length === 0) {
			throw new Error("Failed to parse updated content into blocks");
		}

		// Get the first parsed block (should be the updated version of our block)
		const updatedBlock = updatedBlocks[0];

		if (!updatedBlock) {
			throw new Error("Failed to parse updated block");
		}

		// Update the original block's attributes to preserve the clientID
		const { updateBlockAttributes, replaceInnerBlocks } = dispatch("core/block-editor");

		// Update block attributes
		if (updatedBlock.attributes) {
			updateBlockAttributes(clientId, updatedBlock.attributes);
		}

		// Update inner blocks if they exist
		if (updatedBlock.innerBlocks && updatedBlock.innerBlocks.length > 0) {
			// Map inner blocks to preserve their structure
			const innerBlocks = updatedBlock.innerBlocks.map((innerBlock) => {
				// Recursively handle nested inner blocks
				return this.createBlockFromParsed(innerBlock);
			});
			replaceInnerBlocks(clientId, innerBlocks);
		} else if (block.innerBlocks && block.innerBlocks.length > 0) {
			// If the updated block has no inner blocks but original did, clear them
			replaceInnerBlocks(clientId, []);
		}

		// eslint-disable-next-line no-console
		console.log(`Applied ${changes.length} change(s) to block ${clientId} (${block.name})`);

		return {
			clientId,
			blockName: block.name,
			changesApplied: changes.length,
			message: `Block ${block.name} content updated successfully`,
			originalBlock, // Include original block state for undo
		};
	}

	/**
	 * Apply find/replace changes to a template part's content
	 *
	 * @param {string} clientId The template part's client ID
	 * @param {Object} block    The template part block
	 * @param {Array}  changes  Array of {find, replace} objects
	 * @return {Promise<Object>} Result of the changes
	 */
	async applyTemplatePartChanges(clientId, block, changes) {
		// Get the template part entity to store original content
		const originalEntity = await getTemplatePartEntity(block);

		// eslint-disable-next-line no-console
		console.log("Template part - storing original entity:", {
			hasEntity: !!originalEntity,
			hasContent: !!originalEntity?.content,
			contentType: typeof originalEntity?.content,
			contentKeys: originalEntity?.content ? Object.keys(originalEntity.content) : [],
		});

		// Save original state for undo (includes entity data)
		const originalBlock = {
			clientId,
			name: block.name,
			attributes: { ...block.attributes },
			innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
			isTemplatePart: true,
			entityContent: originalEntity ? originalEntity.content : null,
		};

		// Get the template part's inner blocks
		const { getBlocks } = select("core/block-editor");
		const innerBlocks = getBlocks(clientId);

		if (innerBlocks.length === 0) {
			throw new Error("Template part has no inner blocks to modify");
		}

		// Apply changes to inner blocks recursively
		const { updateBlockAttributes, replaceInnerBlocks } = dispatch("core/block-editor");
		let changesApplied = 0;
		const updatedInnerBlocks = [];

		// Process each inner block
		for (const innerBlock of innerBlocks) {
			// Serialize the inner block
			let blockHtml = serialize(innerBlock);
			let modified = false;

			// Apply all find/replace operations
			for (const change of changes) {
				const { find, replace } = change;

				if (typeof find !== "string" || typeof replace !== "string") {
					throw new Error("Change must have find and replace as strings");
				}

				// Normalize strings
				const normalizedBlockHtml = this.normalizeHtml(blockHtml);
				const normalizedFind = this.normalizeHtml(find);
				const normalizedReplace = this.normalizeHtml(replace);

				// eslint-disable-next-line no-console
				console.log("TEMPLATE PART CHANGE");
				// eslint-disable-next-line no-console
				console.log({
					normalizedBlockHtml,
					normalizedFind,
					normalizedReplace,
				});

				// Perform the replacement
				if (normalizedBlockHtml.includes(normalizedFind)) {
					blockHtml = normalizedBlockHtml.replace(normalizedFind, normalizedReplace);
					modified = true;
					changesApplied++;
					// eslint-disable-next-line no-console
					console.log(`Applied change to template part inner block`);
				}
			}

			// If this inner block was modified, update it in the editor
			if (modified) {
				const updatedBlocks = parse(blockHtml);
				if (updatedBlocks && updatedBlocks.length > 0) {
					const updatedBlock = updatedBlocks[0];

					// Update the inner block's attributes
					if (updatedBlock.attributes) {
						updateBlockAttributes(innerBlock.clientId, updatedBlock.attributes);
					}

					// Update nested inner blocks if they exist
					if (updatedBlock.innerBlocks && updatedBlock.innerBlocks.length > 0) {
						const nestedInnerBlocks = updatedBlock.innerBlocks.map((nested) =>
							this.createBlockFromParsed(nested)
						);
						replaceInnerBlocks(innerBlock.clientId, nestedInnerBlocks);
					}

					// Store the updated block for entity save
					updatedInnerBlocks.push(updatedBlock);
				}
			} else {
				// Keep the original block if not modified
				updatedInnerBlocks.push(innerBlock);
			}
		}

		// Save changes to the template part entity
		// This ensures the changes persist across page reloads
		let entityUpdateResult = null;
		if (changesApplied > 0) {
			entityUpdateResult = await updateTemplatePartContent(block, updatedInnerBlocks);

			if (!entityUpdateResult.success) {
				// eslint-disable-next-line no-console
				console.warn("Template part entity update failed:", entityUpdateResult.message);
			}
		}

		// eslint-disable-next-line no-console
		console.log(`Applied ${changesApplied} change(s) to template part ${clientId}`);

		return {
			clientId,
			blockName: block.name,
			changesApplied,
			message: `Template part content updated successfully`,
			originalBlock,
			isTemplatePart: true,
			entityUpdateResult,
		};
	}

	/**
	 * Restore blocks to their previous state
	 *
	 * @param {Array} undoData Array of original block states
	 * @return {Promise<Object>} Result of the restore operation
	 */
	async restoreBlocks(undoData) {
		if (!undoData || !Array.isArray(undoData)) {
			return { success: false, message: "No undo data available" };
		}

		const { updateBlockAttributes, replaceInnerBlocks } = dispatch("core/block-editor");
		const { getBlock } = select("core/block-editor");
		const results = [];
		const errors = [];

		for (const blockData of undoData) {
			try {
				const {
					clientId,
					attributes,
					innerBlocks,
					isTemplatePart: isTemplatePartBlock,
					entityContent,
				} = blockData;

				if (!clientId) {
					errors.push("Missing clientId in undo data");
					continue;
				}

				// If this is a template part, restore the entity content first
				if (isTemplatePartBlock && entityContent) {
					const block = getBlock(clientId);
					if (block) {
						// Parse the original content back into blocks
						const contentString =
							typeof entityContent === "string"
								? entityContent
								: entityContent.raw || entityContent.rendered;

						// eslint-disable-next-line no-console
						console.log("Restoring template part:", {
							clientId,
							hasEntityContent: !!entityContent,
							contentType: typeof entityContent,
							contentStringLength: contentString?.length,
						});

						if (contentString) {
							const originalBlocks = parse(contentString);

							// eslint-disable-next-line no-console
							console.log("Parsed original blocks:", originalBlocks.length);

							// Update the entity (database)
							const updateResult = await updateTemplatePartContent(block, originalBlocks);

							// eslint-disable-next-line no-console
							console.log("Entity update result:", updateResult);

							if (!updateResult.success) {
								// eslint-disable-next-line no-console
								console.warn("Failed to restore template part entity:", updateResult.message);
								errors.push(`Template part entity restore failed: ${updateResult.message}`);
							}

							// Also update the editor's inner blocks to immediately reflect the changes
							// This ensures the visual editor shows the restored content
							const restoredInnerBlocks = originalBlocks.map((inner) =>
								this.createBlockFromParsed(inner)
							);
							replaceInnerBlocks(clientId, restoredInnerBlocks);

							// eslint-disable-next-line no-console
							console.log("Replaced inner blocks in editor:", restoredInnerBlocks.length);
						} else {
							// eslint-disable-next-line no-console
							console.error("No content string to restore for template part");
						}
					} else {
						// eslint-disable-next-line no-console
						console.error("Could not find block with clientId:", clientId);
					}
				} else {
					// For non-template-part blocks, restore attributes and inner blocks
					// Restore attributes
					updateBlockAttributes(clientId, attributes);

					// Restore inner blocks
					if (innerBlocks && Array.isArray(innerBlocks)) {
						const restoredInnerBlocks = innerBlocks.map((inner) =>
							this.createBlockFromParsed(inner)
						);
						replaceInnerBlocks(clientId, restoredInnerBlocks);
					}
				}

				const messageType = isTemplatePartBlock ? "Template part" : "Block";
				results.push({
					clientId,
					message: `${messageType} restored successfully`,
				});
			} catch (error) {
				errors.push(`Failed to restore block: ${error.message}`);
				// eslint-disable-next-line no-console
				console.error("Failed to restore block:", error);
			}
		}

		return {
			success: errors.length === 0,
			message:
				errors.length === 0 ? "All blocks restored successfully" : "Some blocks failed to restore",
			results,
			errors,
		};
	}

	/**
	 * Normalize HTML string by removing extra whitespace and newlines
	 * Also normalizes block comment JSON attributes to handle attributes
	 * that WordPress omits during serialization
	 *
	 * WordPress omits certain attributes from block comments when they can be
	 * inferred from HTML (e.g., button "text" and "url" are in the <a> tag).
	 * This function removes those attributes from both the source content and
	 * the AI-generated find strings to ensure they match.
	 *
	 * @param {string} html The HTML string to normalize
	 * @return {string} Normalized HTML string
	 */
	normalizeHtml(html) {
		// First normalize whitespace
		let normalized = html
			.replace(/\s+/g, " ") // Replace all whitespace sequences with single space
			.replace(/>\s+</g, "><") // Remove spaces between tags
			.replace(/\\\//g, "/") // Remove backslashes from slashes
			.trim(); // Remove leading/trailing whitespace

		// Normalize block comment attributes
		// WordPress omits default attributes, so we need to normalize them
		// Match block comments with JSON attributes (handles nested objects)
		normalized = normalized.replace(
			/<!--\s*wp:([^\s]+)\s+(\{.*?\})\s*-->/gs,
			(match, blockName, jsonStr) => {
				try {
					// Find the matching closing brace for nested JSON
					let braceCount = 0;
					let endIndex = 0;
					for (let i = 0; i < jsonStr.length; i++) {
						if (jsonStr[i] === "{") {
							braceCount++;
						}
						if (jsonStr[i] === "}") {
							braceCount--;
						}
						if (braceCount === 0) {
							endIndex = i + 1;
							break;
						}
					}
					const actualJsonStr = jsonStr.substring(0, endIndex);
					const attrs = JSON.parse(actualJsonStr);

					// Remove attributes that WordPress omits from serialization
					// These are stored in HTML instead of block comments
					if (blockName === "button") {
						// WordPress doesn't serialize these in block comments
						delete attrs.text; // Text is in the <a> tag content
						delete attrs.url; // URL is in the href attribute
						delete attrs.linkTarget; // Target is in the HTML
						delete attrs.rel; // Rel is in the HTML
						// Remove default attribute values
						if (attrs.tagName === "a") {
							delete attrs.tagName;
						}
						if (attrs.type === "button") {
							delete attrs.type;
						}
					}

					// Sort keys for consistent comparison
					const sortedAttrs = Object.keys(attrs)
						.sort()
						.reduce((acc, key) => {
							acc[key] = attrs[key];
							return acc;
						}, {});
					const normalizedJson = JSON.stringify(sortedAttrs);
					return `<!-- wp:${blockName} ${normalizedJson} -->`;
				} catch (e) {
					// If JSON parsing fails, return original
					return match;
				}
			}
		);

		return normalized;
	}

	/**
	 * Create a block structure from a parsed block (recursive for inner blocks)
	 *
	 * @param {Object} parsedBlock The parsed block object
	 * @return {Object} Block structure compatible with WordPress block editor
	 */
	createBlockFromParsed(parsedBlock) {
		const innerBlocks = parsedBlock.innerBlocks
			? parsedBlock.innerBlocks.map((inner) => this.createBlockFromParsed(inner))
			: [];

		return createBlock(parsedBlock.name, parsedBlock.attributes || {}, innerBlocks);
	}
}

// Create and export a singleton instance
const actionExecutor = new ActionExecutor();
export default actionExecutor;
