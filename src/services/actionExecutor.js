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
 * - edit_content: Apply find/replace changes to block content (with edit, delete, add sub-actions)
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
			const contentAction = contentItem.action; // "edit", "delete", or "add"
			const { changes } = contentItem;

			if (!contentAction) {
				errors.push("Content item missing 'action' property");
				continue;
			}

			try {
				let result;
				if (contentAction === "edit") {
					if (!clientId) {
						errors.push("Edit action requires client_id");
						continue;
					}
					if (!changes || !Array.isArray(changes)) {
						errors.push(`Edit action for ${clientId} missing changes array`);
						continue;
					}
					result = await this.handleEditAction(clientId, changes);
				} else if (contentAction === "delete") {
					if (!clientId) {
						errors.push("Delete action requires client_id");
						continue;
					}
					if (changes !== "remove_block") {
						errors.push(`Delete action for ${clientId} must have changes: "remove_block"`);
						continue;
					}
					result = await this.handleDeleteAction(clientId);
				} else if (contentAction === "add") {
					if (!changes || !Array.isArray(changes)) {
						errors.push("Add action missing changes array");
						continue;
					}
					result = await this.handleAddAction(clientId, changes);
				} else {
					errors.push(`Unsupported content action: ${contentAction}`);
					continue;
				}
				results.push(result);
			} catch (error) {
				errors.push(`Failed to execute ${contentAction} action: ${error.message}`);
				// eslint-disable-next-line no-console
				console.error(`Failed to execute ${contentAction} action:`, error);
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
	 * Handle "edit" action - apply find/replace changes to a block's content
	 *
	 * @param {string} clientId The block's client ID
	 * @param {Array}  changes  Array of {find, replace} objects
	 * @return {Promise<Object>} Result of the changes
	 */
	async handleEditAction(clientId, changes) {
		return this.applyContentChanges(clientId, changes);
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

				// Perform the replacement
				if (normalizedBlockHtml.includes(normalizedFind)) {
					blockHtml = normalizedBlockHtml.replace(normalizedFind, normalizedReplace);
					modified = true;
					changesApplied++;
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

						if (contentString) {
							const originalBlocks = parse(contentString);

							// Update the entity (database)
							const updateResult = await updateTemplatePartContent(block, originalBlocks);

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
	 * Handle "delete" action - remove a block from the editor
	 *
	 * @param {string} clientId The block's client ID to delete
	 * @return {Promise<Object>} Result of the deletion
	 */
	async handleDeleteAction(clientId) {
		const { getBlock } = select("core/block-editor");
		const block = getBlock(clientId);

		if (!block) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		// Check if this is a template part - handle differently
		if (isTemplatePart(block)) {
			return this.handleDeleteTemplatePart(clientId, block);
		}

		// Save the original block state for undo
		const originalBlock = {
			clientId,
			name: block.name,
			attributes: { ...block.attributes },
			innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
		};

		// Remove the block
		const { removeBlock } = dispatch("core/block-editor");
		removeBlock(clientId);

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} deleted successfully`,
			originalBlock, // Include original block state for undo
		};
	}

	/**
	 * Handle deletion of a template part
	 *
	 * @param {string} clientId The template part's client ID
	 * @param {Object} block    The template part block
	 * @return {Promise<Object>} Result of the deletion
	 */
	async handleDeleteTemplatePart(clientId, block) {
		// Get the template part entity to store original content
		const originalEntity = await getTemplatePartEntity(block);

		// Save original state for undo (includes entity data)
		const originalBlock = {
			clientId,
			name: block.name,
			attributes: { ...block.attributes },
			innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
			isTemplatePart: true,
			entityContent: originalEntity ? originalEntity.content : null,
		};

		// Remove the template part block
		const { removeBlock } = dispatch("core/block-editor");
		removeBlock(clientId);

		return {
			clientId,
			blockName: block.name,
			message: `Template part deleted successfully`,
			originalBlock,
			isTemplatePart: true,
		};
	}

	/**
	 * Get effective root blocks (root blocks + first level of post-content blocks)
	 *
	 * @return {Object} Object with blocks array and parentClientId (null for root, post-content clientId for post-content)
	 */
	getEffectiveRootBlocks() {
		const { getBlocks } = select("core/block-editor");
		const rootBlocks = getBlocks();

		// Find the post-content block
		const postContentBlock = rootBlocks.find((block) => block.name === "core/post-content");

		if (postContentBlock) {
			// Get inner blocks of post-content
			const postContentInnerBlocks = getBlocks(postContentBlock.clientId);
			if (postContentInnerBlocks.length > 0) {
				// Return post-content inner blocks as effective root
				return {
					blocks: postContentInnerBlocks,
					parentClientId: postContentBlock.clientId,
				};
			}
		}

		// No post-content or it's empty, use actual root blocks
		return {
			blocks: rootBlocks,
			parentClientId: null,
		};
	}

	/**
	 * Find which context a block belongs to (root or post-content)
	 *
	 * @param {string} clientId The block's client ID
	 * @return {Object|null} Object with blocks array and parentClientId, or null if not found
	 */
	findBlockContext(clientId) {
		const { getBlocks } = select("core/block-editor");
		const rootBlocks = getBlocks();

		// Check if it's a root block
		const rootIndex = rootBlocks.findIndex((block) => block.clientId === clientId);
		if (rootIndex !== -1) {
			return {
				blocks: rootBlocks,
				parentClientId: null,
				index: rootIndex,
			};
		}

		// Check if it's inside post-content
		const postContentBlock = rootBlocks.find((block) => block.name === "core/post-content");
		if (postContentBlock) {
			const postContentInnerBlocks = getBlocks(postContentBlock.clientId);
			const innerIndex = postContentInnerBlocks.findIndex((block) => block.clientId === clientId);
			if (innerIndex !== -1) {
				return {
					blocks: postContentInnerBlocks,
					parentClientId: postContentBlock.clientId,
					index: innerIndex,
				};
			}
		}

		return null;
	}

	/**
	 * Handle "add" action - add new block(s) to the editor
	 *
	 * @param {string|null} clientId The client ID to add after (null for top of page)
	 * @param {Array}       changes  Array of {block_content} objects
	 * @return {Promise<Object>} Result of the addition
	 */
	async handleAddAction(clientId, changes) {
		const { getBlocks, getBlock } = select("core/block-editor");
		const { insertBlocks } = dispatch("core/block-editor");
		const errors = [];

		// Parse all block contents
		const blocksToInsert = [];
		for (const change of changes) {
			if (!change.block_content || typeof change.block_content !== "string") {
				errors.push("Add action change missing block_content string");
				continue;
			}

			try {
				// Parse the block content into blocks
				const parsedBlocks = parse(change.block_content);
				if (!parsedBlocks || parsedBlocks.length === 0) {
					errors.push("Failed to parse block_content into blocks");
					continue;
				}

				// Convert parsed blocks to WordPress block format
				const wpBlocks = parsedBlocks.map((parsedBlock) => this.createBlockFromParsed(parsedBlock));
				blocksToInsert.push(...wpBlocks);
			} catch (error) {
				errors.push(`Failed to parse block_content: ${error.message}`);
				// eslint-disable-next-line no-console
				console.error("Failed to parse block_content:", error);
			}
		}

		if (blocksToInsert.length === 0) {
			throw new Error("No valid blocks to insert");
		}

		// Determine insertion position
		if (clientId === null) {
			// Insert at the top of the page
			const effectiveRoot = this.getEffectiveRootBlocks();
			if (effectiveRoot.blocks.length > 0) {
				// Insert at the beginning of the effective root blocks
				if (effectiveRoot.parentClientId) {
					// Insert into post-content
					insertBlocks(blocksToInsert, 0, effectiveRoot.parentClientId);
				} else {
					// Insert at root
					insertBlocks(blocksToInsert, 0, effectiveRoot.blocks[0].clientId);
				}
			} else {
				// Page is empty, check if we have post-content block
				const rootBlocks = getBlocks();
				const postContentBlock = rootBlocks.find((block) => block.name === "core/post-content");
				if (postContentBlock) {
					// Insert into post-content
					insertBlocks(blocksToInsert, 0, postContentBlock.clientId);
				} else {
					// Insert at root
					insertBlocks(blocksToInsert, 0);
				}
			}
		} else {
			// Insert after the specified block
			const targetBlock = getBlock(clientId);
			if (!targetBlock) {
				throw new Error(`Target block with clientId ${clientId} not found`);
			}

			// Find which context the target block belongs to
			const context = this.findBlockContext(clientId);
			if (!context) {
				throw new Error(`Target block ${clientId} not found in root blocks or post-content`);
			}

			// Insert after the target block in its context
			const insertIndex = context.index + 1;
			if (context.parentClientId) {
				// Insert into post-content (always use parentClientId for post-content)
				insertBlocks(blocksToInsert, insertIndex, context.parentClientId);
			} else if (insertIndex < context.blocks.length) {
				// Insert at root level before the next block
				insertBlocks(blocksToInsert, insertIndex, context.blocks[insertIndex].clientId);
			} else {
				// Insert at the end of root
				insertBlocks(blocksToInsert, insertIndex);
			}
		}

		// Return result with original state (empty since these are new blocks)
		// For undo, we'll need to track the clientIds of the inserted blocks
		// Note: createBlock generates new clientIds, so we need to get them after insertion
		const insertedClientIds = blocksToInsert
			.map((block) => {
				// After insertion, blocks will have clientIds assigned by WordPress
				// We'll need to track these for undo functionality
				return block.clientId || null;
			})
			.filter(Boolean);

		return {
			clientId: clientId || "root",
			blocksAdded: blocksToInsert.length,
			insertedClientIds,
			message: `Added ${blocksToInsert.length} block(s) successfully`,
			errors: errors.length > 0 ? errors : undefined,
		};
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
