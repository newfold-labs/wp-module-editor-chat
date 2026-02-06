/**
 * WordPress dependencies
 */
import { dispatch, select, resolveSelect } from "@wordpress/data";
import { store as coreStore } from "@wordpress/core-data";
import { serialize, parse, createBlock } from "@wordpress/blocks";

/**
 * Internal dependencies
 */
import {
	updateTemplatePartContent,
	getTemplatePartEntity,
	isTemplatePart,
	fetchTemplatePartContent,
} from "../utils/editorHelpers";

/**
 * Simple Action Executor
 *
 * Executes actions received from the AI chat API.
 * Supports the following action types:
 * - edit_content: Edit block content with two modes:
 *   - patch: Apply find/replace changes to block content
 *   - rewrite: Replace entire block content
 *   Also supports add and delete operations
 * - change_site_colors: Update WordPress global styles color palette
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

		if (action.action === "change_site_colors") {
			return this.handleChangeSiteColorsAction(action);
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

		if (!data) {
			throw new Error("Edit content action requires data object");
		}

		const operationType = data.operation_type;
		if (!operationType) {
			throw new Error("Edit content action requires data.operation_type");
		}

		const results = [];
		const errors = [];

		try {
			let result;
			if (operationType === "edit") {
				// Parser outputs: data.section and data.block_content
				// The parser has already processed patch mode server-side,
				// so we treat all edit operations as rewrite (full replacement)
				const clientId = data.section;
				if (!clientId) {
					throw new Error("Edit action requires section");
				}

				const blockContent = data.block_content;
				if (!blockContent) {
					throw new Error("Edit action requires block_content");
				}

				result = await this.handleRewriteAction(clientId, blockContent);
				results.push(result);
			} else if (operationType === "delete") {
				// Parser outputs: data.section
				const clientId = data.section;
				if (!clientId) {
					throw new Error("Delete action requires section");
				}
				result = await this.handleDeleteAction(clientId);
				results.push(result);
			} else if (operationType === "add") {
				// Parser outputs: data.location and data.block_content
				const clientId = data.location; // Can be null for top of page
				const blockContent = data.block_content;
				if (!blockContent) {
					throw new Error("Add action requires block_content");
				}
				result = await this.handleAddAction(clientId || null, [{ block_content: blockContent }]);
				results.push(result);
			} else {
				throw new Error(`Unsupported operation_type: ${operationType}`);
			}
		} catch (error) {
			errors.push(`Failed to execute ${operationType} action: ${error.message}`);
			// eslint-disable-next-line no-console
			console.error(`Failed to execute ${operationType} action:`, error);
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
	 * Walk up the block tree and return the closest ancestor template-part block,
	 * or null if the block is not inside a template part.
	 *
	 * @param {string} clientId The block's client ID
	 * @return {Object|null} The ancestor template-part block, or null
	 */
	findAncestorTemplatePart(clientId) {
		const { getBlockRootClientId, getBlock } = select("core/block-editor");
		let currentId = getBlockRootClientId(clientId);
		while (currentId) {
			const block = getBlock(currentId);
			if (block && isTemplatePart(block)) {
				return block;
			}
			currentId = getBlockRootClientId(currentId);
		}
		return null;
	}

	/**
	 * Compute the relative index path from a template part to a nested block.
	 * Returns an array of indices from the template part's root to the target.
	 *
	 * @param {string} templatePartClientId The template part's clientId
	 * @param {string} targetClientId       The target block's clientId
	 * @return {Array<number>|null} Index path, or null if not inside the template part
	 */
	getBlockPathInTemplatePart(templatePartClientId, targetClientId) {
		const { getBlockRootClientId, getBlockIndex } = select("core/block-editor");
		const path = [];
		let currentId = targetClientId;

		while (currentId && currentId !== templatePartClientId) {
			path.unshift(getBlockIndex(currentId));
			currentId = getBlockRootClientId(currentId);
		}

		return currentId === templatePartClientId ? path : null;
	}

	/**
	 * Remove a block at the given index path from a parsed block tree.
	 *
	 * @param {Array}         blocks Parsed block tree
	 * @param {Array<number>} path   Index path to the block to remove
	 * @return {Array} New block tree with the block removed
	 */
	removeBlockAtPath(blocks, path) {
		if (!path || path.length === 0) return blocks;

		const [index, ...rest] = path;

		if (rest.length === 0) {
			return blocks.filter((_, i) => i !== index);
		}

		return blocks.map((block, i) => {
			if (i !== index) return block;
			return {
				...block,
				innerBlocks: this.removeBlockAtPath(block.innerBlocks || [], rest),
			};
		});
	}

	/**
	 * Replace a block at the given index path with new blocks.
	 *
	 * @param {Array}         blocks    Parsed block tree
	 * @param {Array<number>} path      Index path to the block to replace
	 * @param {Array}         newBlocks Replacement blocks
	 * @return {Array} New block tree with the block replaced
	 */
	replaceBlockAtPath(blocks, path, newBlocks) {
		if (!path || path.length === 0) return blocks;

		const [index, ...rest] = path;

		if (rest.length === 0) {
			return [
				...blocks.slice(0, index),
				...newBlocks,
				...blocks.slice(index + 1),
			];
		}

		return blocks.map((block, i) => {
			if (i !== index) return block;
			return {
				...block,
				innerBlocks: this.replaceBlockAtPath(block.innerBlocks || [], rest, newBlocks),
			};
		});
	}

	/**
	 * Insert blocks after a given index path in a parsed block tree.
	 *
	 * @param {Array}         blocks    Parsed block tree
	 * @param {Array<number>} path      Index path of the block to insert after
	 * @param {Array}         newBlocks Blocks to insert
	 * @return {Array} New block tree with blocks inserted
	 */
	insertBlocksAtPath(blocks, path, newBlocks) {
		if (!path || path.length === 0) return blocks;

		const [index, ...rest] = path;

		if (rest.length === 0) {
			return [
				...blocks.slice(0, index + 1),
				...newBlocks,
				...blocks.slice(index + 1),
			];
		}

		return blocks.map((block, i) => {
			if (i !== index) return block;
			return {
				...block,
				innerBlocks: this.insertBlocksAtPath(block.innerBlocks || [], rest, newBlocks),
			};
		});
	}

	/**
	 * Modify a template part's entity content, update the editor, and save to DB.
	 *
	 * Template parts use WordPress's "controlled inner blocks" mechanism —
	 * their inner blocks are driven by the entity record, not the block editor store.
	 * Direct dispatch calls (removeBlock, updateBlockAttributes) on nested blocks
	 * get overwritten by the entity. This method works directly with the entity content.
	 *
	 * @param {Object}   templatePartBlock The template part block
	 * @param {Function} modifyFn          Function that takes parsed blocks and returns modified blocks
	 * @return {Promise<Object>} Save result
	 */
	async modifyTemplatePartEntity(templatePartBlock, modifyFn) {
		const entityContent = await fetchTemplatePartContent(templatePartBlock);

		if (!entityContent) {
			throw new Error("Template part has no content");
		}

		const parsedBlocks = parse(entityContent);
		const modifiedBlocks = modifyFn(parsedBlocks);

		// Convert to proper WordPress blocks and update the visual editor
		const updatedInnerBlocks = modifiedBlocks.map((b) => this.createBlockFromParsed(b));
		const { replaceInnerBlocks } = dispatch("core/block-editor");
		replaceInnerBlocks(templatePartBlock.clientId, updatedInnerBlocks);

		// Save to entity / DB — use proper WP blocks so serialize() produces canonical HTML
		const result = await updateTemplatePartContent(templatePartBlock, updatedInnerBlocks);

		return result;
	}

	/**
	 * Handle "patch" action - apply find/replace changes to a block's content
	 *
	 * @param {string} clientId The block's client ID
	 * @param {Array}  changes  Array of {find, replace} objects
	 * @return {Promise<Object>} Result of the changes
	 */
	async handlePatchAction(clientId, changes) {
		return this.applyContentChanges(clientId, changes);
	}

	/**
	 * Handle "rewrite" action - replace entire block content
	 *
	 * @param {string} clientId     The block's client ID
	 * @param {string} blockContent The new block content HTML
	 * @return {Promise<Object>} Result of the rewrite
	 */
	async handleRewriteAction(clientId, blockContent) {
		const { getBlock } = select("core/block-editor");
		const block = getBlock(clientId);

		if (!block) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		// Check if this is a template part - handle differently
		if (isTemplatePart(block)) {
			return this.applyTemplatePartRewrite(clientId, block, blockContent);
		}

		// Save the original block state for undo
		const originalBlock = {
			clientId,
			name: block.name,
			attributes: { ...block.attributes },
			innerBlocks: block.innerBlocks ? [...block.innerBlocks] : [],
		};

		// Parse the new block content into blocks
		const updatedBlocks = parse(blockContent);

		if (!updatedBlocks || updatedBlocks.length === 0) {
			throw new Error("Failed to parse block_content into blocks");
		}

		// Check if this block lives inside a template part
		const ancestorTemplatePart = this.findAncestorTemplatePart(clientId);

		if (ancestorTemplatePart) {
			// Template parts use controlled inner blocks — direct updateBlockAttributes
			// gets overwritten by the entity. Modify the entity content directly.
			const path = this.getBlockPathInTemplatePart(ancestorTemplatePart.clientId, clientId);
			if (!path) {
				throw new Error(`Could not compute path for block ${clientId} in template part`);
			}
			await this.modifyTemplatePartEntity(ancestorTemplatePart, (blocks) =>
				this.replaceBlockAtPath(blocks, path, updatedBlocks)
			);

			return {
				clientId,
				blockName: block.name,
				message: `Block ${block.name} content rewritten in template part successfully`,
				originalBlock,
			};
		}

		// For regular blocks, apply changes directly to the block editor
		const updatedBlock = updatedBlocks[0];

		if (!updatedBlock) {
			throw new Error("Failed to parse updated block");
		}

		const { updateBlockAttributes, replaceInnerBlocks } = dispatch("core/block-editor");

		if (updatedBlock.attributes) {
			// updateBlockAttributes merges — it won't remove attributes the AI deleted.
			// Explicitly unset any old attributes that are absent from the new markup.
			const attrsToApply = { ...updatedBlock.attributes };
			for (const key of Object.keys(block.attributes)) {
				if (!(key in attrsToApply)) {
					attrsToApply[key] = undefined;
				}
			}
			updateBlockAttributes(clientId, attrsToApply);
		}

		if (updatedBlock.innerBlocks && updatedBlock.innerBlocks.length > 0) {
			const innerBlocks = updatedBlock.innerBlocks.map((innerBlock) => {
				return this.createBlockFromParsed(innerBlock);
			});
			replaceInnerBlocks(clientId, innerBlocks);
		} else if (block.innerBlocks && block.innerBlocks.length > 0) {
			replaceInnerBlocks(clientId, []);
		}

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} content rewritten successfully`,
			originalBlock,
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
	 * Apply rewrite to a template part's content
	 *
	 * @param {string} clientId     The template part's client ID
	 * @param {Object} block        The template part block
	 * @param {string} blockContent The new block content HTML
	 * @return {Promise<Object>} Result of the rewrite
	 */
	async applyTemplatePartRewrite(clientId, block, blockContent) {
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

		// Strip template-part wrapper if the AI included it.
		// core/template-part is a dynamic block — its save() returns empty content,
		// so parsing the full wrapper causes a block validation error.
		let innerContent = blockContent;
		const tpMatch = blockContent.match(
			/^<!--\s*wp:template-part\s+\{[\s\S]*?\}\s*-->([\s\S]*)<!--\s*\/wp:template-part\s*-->\s*$/
		);
		if (tpMatch) {
			const rawInner = tpMatch[1].trim();
			// Strip the outer HTML tag (e.g. <header ...>...</header>)
			const tagMatch = rawInner.match(/^<[a-z][^>]*>([\s\S]*)<\/[a-z]+>$/i);
			innerContent = tagMatch ? tagMatch[1].trim() : rawInner;
		}

		// Parse the inner block content
		const updatedBlocks = parse(innerContent);

		if (!updatedBlocks || updatedBlocks.length === 0) {
			throw new Error("Failed to parse block_content into blocks");
		}

		// Update inner blocks in the editor
		const { replaceInnerBlocks } = dispatch("core/block-editor");

		// Convert parsed blocks to WordPress block format
		const updatedInnerBlocks = updatedBlocks.map((parsedBlock) =>
			this.createBlockFromParsed(parsedBlock)
		);

		// Replace all inner blocks of the template part
		replaceInnerBlocks(clientId, updatedInnerBlocks);

		// Save changes to the template part entity
		// This ensures the changes persist across page reloads
		// Use the proper WP blocks (not raw parsed blocks) so serialize() goes through
		// the block's save() function, producing canonical HTML that passes validation on reload.
		const entityUpdateResult = await updateTemplatePartContent(block, updatedInnerBlocks);

		if (!entityUpdateResult.success) {
			// eslint-disable-next-line no-console
			console.warn("Template part entity update failed:", entityUpdateResult.message);
		}

		return {
			clientId,
			blockName: block.name,
			message: `Template part content rewritten successfully`,
			originalBlock,
			isTemplatePart: true,
			entityUpdateResult,
		};
	}

	/**
	 * Apply find/replace changes to a template part's content
	 *
	 * Uses fetchTemplatePartContent to ensure we work with the same content format
	 * that was sent as context to the AI, guaranteeing consistency.
	 *
	 * @param {string} clientId The template part's client ID
	 * @param {Object} block    The template part block
	 * @param {Array}  changes  Array of {find, replace} objects
	 * @return {Promise<Object>} Result of the changes
	 */
	async applyTemplatePartChanges(clientId, block, changes) {
		const coreResolve = resolveSelect("core");

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

		// Get the template part content using the same function that builds context
		// This ensures we're working with the exact same content format
		const templatePartContent = await fetchTemplatePartContent(block, coreResolve);
		if (!templatePartContent) {
			throw new Error("Template part has no content to modify");
		}

		// Apply all find/replace operations to the full template part content
		let updatedContent = templatePartContent;
		let changesApplied = 0;

		for (const change of changes) {
			const { find, replace } = change;

			if (typeof find !== "string" || typeof replace !== "string") {
				throw new Error("Change must have find and replace as strings");
			}

			// Normalize strings
			const normalizedContent = this.normalizeHtml(updatedContent);
			const normalizedFind = this.normalizeHtml(find);
			const normalizedReplace = this.normalizeHtml(replace);

			// Perform the replacement
			if (normalizedContent.includes(normalizedFind)) {
				updatedContent = normalizedContent.replace(normalizedFind, normalizedReplace);
				changesApplied++;
			}
		}

		// If no changes were applied, return early
		if (changesApplied === 0) {
			return {
				clientId,
				blockName: block.name,
				changesApplied: 0,
				message: `No matching content found in template part`,
				originalBlock,
				isTemplatePart: true,
			};
		}

		// Parse the updated content back into blocks
		const updatedBlocks = parse(updatedContent);

		if (!updatedBlocks || updatedBlocks.length === 0) {
			throw new Error("Failed to parse updated template part content into blocks");
		}

		// Update the editor's inner blocks to reflect the changes
		const { replaceInnerBlocks } = dispatch("core/block-editor");
		const updatedInnerBlocks = updatedBlocks.map((parsedBlock) =>
			this.createBlockFromParsed(parsedBlock)
		);
		replaceInnerBlocks(clientId, updatedInnerBlocks);

		// Save changes to the template part entity
		// This ensures the changes persist across page reloads
		const entityUpdateResult = await updateTemplatePartContent(block, updatedInnerBlocks);

		if (!entityUpdateResult.success) {
			// eslint-disable-next-line no-console
			console.warn("Template part entity update failed:", entityUpdateResult.message);
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
	 *
	 * Normalizes whitespace to ensure consistent comparison between
	 * the content sent as context and the find/replace strings.
	 *
	 * @param {string} html The HTML string to normalize
	 * @return {string} Normalized HTML string
	 */
	normalizeHtml(html) {
		// First normalize whitespace
		const normalized = html
			.replace(/\s+/g, " ") // Replace all whitespace sequences with single space
			.replace(/>\s+</g, "><") // Remove spaces between tags
			.replace(/\\\//g, "/") // Remove backslashes from slashes
			.trim(); // Remove leading/trailing whitespace

		return normalized;
	}

	/**
	 * Handle "move" action - move a block to a new position relative to another block
	 *
	 * @param {string} clientId       The clientId of the block to move
	 * @param {string} targetClientId The clientId of the target block to position relative to
	 * @param {string} position       "before" or "after" the target block
	 * @return {Promise<Object>} Result of the move, including original position for undo
	 */
	async handleMoveAction(clientId, targetClientId, position) {
		const { getBlock, getBlockRootClientId, getBlockIndex } = select("core/block-editor");

		const block = getBlock(clientId);
		if (!block) {
			throw new Error(`Block with clientId ${clientId} not found`);
		}

		const targetBlock = getBlock(targetClientId);
		if (!targetBlock) {
			throw new Error(`Target block with clientId ${targetClientId} not found`);
		}

		// Record original position for undo
		const originalRootClientId = getBlockRootClientId(clientId) || "";
		const originalIndex = getBlockIndex(clientId);

		// Check if source or target is inside a template part
		const sourceAncestor = this.findAncestorTemplatePart(clientId);
		const targetAncestor = this.findAncestorTemplatePart(targetClientId);

		if (sourceAncestor || targetAncestor) {
			// Moving within or between template parts — use entity-based approach
			// For now, only support moves within the SAME template part
			if (sourceAncestor && targetAncestor &&
				sourceAncestor.clientId === targetAncestor.clientId) {
				const sourcePath = this.getBlockPathInTemplatePart(sourceAncestor.clientId, clientId);
				const targetPath = this.getBlockPathInTemplatePart(targetAncestor.clientId, targetClientId);

				if (!sourcePath || !targetPath) {
					throw new Error("Could not compute paths for move within template part");
				}

				await this.modifyTemplatePartEntity(sourceAncestor, (blocks) => {
					// First, extract the block at sourcePath
					let movedBlock = null;
					const findBlock = (tree, path) => {
						if (path.length === 1) return tree[path[0]];
						return findBlock(tree[path[0]].innerBlocks || [], path.slice(1));
					};
					movedBlock = findBlock(blocks, sourcePath);
					if (!movedBlock) return blocks;

					// Remove from source
					let modified = this.removeBlockAtPath(blocks, sourcePath);

					// Recalculate target path after removal (indices may have shifted)
					// Insert at the target position
					if (position === "after") {
						modified = this.insertBlocksAtPath(modified, targetPath, [movedBlock]);
					} else {
						// "before" — insert before the target
						const parentPath = targetPath.slice(0, -1);
						const targetIdx = targetPath[targetPath.length - 1];
						const insertAt = [...parentPath, Math.max(0, targetIdx - 1)];
						modified = this.insertBlocksAtPath(modified, insertAt, [movedBlock]);
					}

					return modified;
				});
			} else {
				// Cross-template-part moves — fall back to standard dispatch
				const { moveBlockToPosition } = dispatch("core/block-editor");
				const targetRootClientId = getBlockRootClientId(targetClientId) || "";
				let targetIndex = getBlockIndex(targetClientId);
				if (position === "after") targetIndex += 1;
				if (originalRootClientId === targetRootClientId && originalIndex < targetIndex) {
					targetIndex -= 1;
				}
				moveBlockToPosition(clientId, originalRootClientId, targetRootClientId, targetIndex);
			}
		} else {
			// Regular blocks — use standard dispatch
			const { moveBlockToPosition } = dispatch("core/block-editor");
			const targetRootClientId = getBlockRootClientId(targetClientId) || "";
			let targetIndex = getBlockIndex(targetClientId);
			if (position === "after") targetIndex += 1;
			if (originalRootClientId === targetRootClientId && originalIndex < targetIndex) {
				targetIndex -= 1;
			}
			moveBlockToPosition(clientId, originalRootClientId, targetRootClientId, targetIndex);
		}

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} moved ${position} ${targetBlock.name} successfully`,
			originalPosition: {
				rootClientId: originalRootClientId,
				index: originalIndex,
			},
		};
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

		// Check if this block lives inside a template part
		const ancestorTemplatePart = this.findAncestorTemplatePart(clientId);

		if (ancestorTemplatePart) {
			// Template parts use controlled inner blocks — direct removeBlock gets
			// overwritten by the entity. Modify the entity content directly instead.
			const path = this.getBlockPathInTemplatePart(ancestorTemplatePart.clientId, clientId);
			if (!path) {
				throw new Error(`Could not compute path for block ${clientId} in template part`);
			}
			await this.modifyTemplatePartEntity(ancestorTemplatePart, (blocks) =>
				this.removeBlockAtPath(blocks, path)
			);

			return {
				clientId,
				blockName: block.name,
				message: `Block ${block.name} deleted from template part successfully`,
				originalBlock,
			};
		}

		// For regular blocks, use removeBlock
		const { removeBlock } = dispatch("core/block-editor");
		removeBlock(clientId);

		return {
			clientId,
			blockName: block.name,
			message: `Block ${block.name} deleted successfully`,
			originalBlock,
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
	 * Find a block's parent and index at any nesting depth.
	 *
	 * Uses getBlockRootClientId / getBlockIndex from the block editor store,
	 * which work for blocks at any depth in the tree (root, post-content,
	 * inner blocks of groups/columns/etc.).
	 *
	 * @param {string} clientId The block's client ID
	 * @return {Object|null} { parentClientId, index } or null if not found
	 */
	findBlockContext(clientId) {
		const { getBlockRootClientId, getBlockIndex, getBlock } = select("core/block-editor");

		const block = getBlock(clientId);
		if (!block) {
			return null;
		}

		const parentClientId = getBlockRootClientId(clientId) || "";
		const index = getBlockIndex(clientId);

		if (index === -1) {
			return null;
		}

		return {
			parentClientId,
			index,
		};
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

		// Parse all block contents (raw parsed blocks for entity, WP blocks for editor)
		const parsedBlocksList = [];
		const blocksToInsert = [];
		for (const change of changes) {
			if (!change.block_content || typeof change.block_content !== "string") {
				errors.push("Add action change missing block_content string");
				continue;
			}

			try {
				const parsedBlocks = parse(change.block_content);
				if (!parsedBlocks || parsedBlocks.length === 0) {
					errors.push("Failed to parse block_content into blocks");
					continue;
				}

				parsedBlocksList.push(...parsedBlocks);
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

		// Check if the insertion target is inside a template part
		const ancestorTemplatePart = clientId ? this.findAncestorTemplatePart(clientId) : null;

		if (ancestorTemplatePart) {
			// Insert into a template part via entity content
			const path = this.getBlockPathInTemplatePart(ancestorTemplatePart.clientId, clientId);
			if (!path) {
				throw new Error(`Could not compute path for block ${clientId} in template part`);
			}
			await this.modifyTemplatePartEntity(ancestorTemplatePart, (blocks) =>
				this.insertBlocksAtPath(blocks, path, parsedBlocksList)
			);
		} else {
			// Regular insertion via block editor
			if (clientId === null) {
				const effectiveRoot = this.getEffectiveRootBlocks();
				if (effectiveRoot.blocks.length > 0) {
					if (effectiveRoot.parentClientId) {
						insertBlocks(blocksToInsert, 0, effectiveRoot.parentClientId);
					} else {
						insertBlocks(blocksToInsert, 0, effectiveRoot.blocks[0].clientId);
					}
				} else {
					const rootBlocks = getBlocks();
					const postContentBlock = rootBlocks.find((block) => block.name === "core/post-content");
					if (postContentBlock) {
						insertBlocks(blocksToInsert, 0, postContentBlock.clientId);
					} else {
						insertBlocks(blocksToInsert, 0);
					}
				}
			} else {
				const targetBlock = getBlock(clientId);
				if (!targetBlock) {
					throw new Error(`Target block with clientId ${clientId} not found`);
				}

				const context = this.findBlockContext(clientId);
				if (!context) {
					throw new Error(`Target block ${clientId} not found in the block tree`);
				}

				const insertIndex = context.index + 1;
				insertBlocks(
					blocksToInsert,
					insertIndex,
					context.parentClientId || undefined
				);
			}
		}

		const insertedClientIds = blocksToInsert
			.map((block) => block.clientId || null)
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

	/**
	 * Handle change_site_colors action
	 *
	 * Uses the same logic as useColorSettings hook's updateCustomColor function
	 *
	 * @param {Object} action The action data
	 * @return {Promise<Object>} Result of the action
	 */
	async handleChangeSiteColorsAction(action) {
		const { data } = action;

		if (!data || !data.colors || !Array.isArray(data.colors)) {
			throw new Error("Change site colors action requires data.colors array");
		}

		// Get global styles ID and settings using the same pattern as useColorSettings
		const { __experimentalGetCurrentGlobalStylesId, getEditedEntityRecord } = select(coreStore);
		const globalStylesId = __experimentalGetCurrentGlobalStylesId
			? __experimentalGetCurrentGlobalStylesId()
			: undefined;

		if (!globalStylesId) {
			throw new Error(
				"Global styles not found. Please ensure you have permission to edit global styles."
			);
		}

		// Get current global styles record (same as useColorSettings)
		const record = getEditedEntityRecord("root", "globalStyles", globalStylesId);

		if (!record || !record.settings) {
			throw new Error("Unable to access global styles settings.");
		}

		const settings = record.settings;
		const rawPalette = settings?.color?.palette?.theme;
		const themePalette = rawPalette || [];

		// Save original state for undo
		const originalStyles = JSON.parse(JSON.stringify(settings));

		// Update colors using the same logic as updateCustomColor from useColorSettings
		// For each color update, map over themePalette and update matching slugs
		let updatedPalette = themePalette;
		for (const colorUpdate of data.colors) {
			const { slug, color: newColor } = colorUpdate;

			if (!slug || !newColor) {
				// eslint-disable-next-line no-console
				console.warn("Invalid color update:", colorUpdate);
				continue;
			}

			// Use the same pattern as updateCustomColor: map and update matching slug
			updatedPalette = updatedPalette.map((color) =>
				color.slug === slug ? { ...color, color: newColor } : color
			);
		}

		// Use the same pattern as setConfig from useColorSettings
		const { editEntityRecord } = dispatch(coreStore);

		editEntityRecord("root", "globalStyles", globalStylesId, {
			settings: {
				...(settings || {}),
				color: {
					palette: {
						...(settings?.color?.palette || {}),
						theme: updatedPalette,
					},
				},
			},
		});

		return {
			type: "change_site_colors",
			success: true,
			message: "Site colors updated successfully",
			colorsUpdated: data.colors.length,
			originalStyles, // Include original state for undo
			globalStylesId, // Include global styles ID for restore
		};
	}

	/**
	 * Restore global styles to their previous state
	 *
	 * @param {Object} undoData Object containing originalStyles and globalStylesId
	 * @return {Promise<Object>} Result of the restore operation
	 */
	async restoreGlobalStyles(undoData) {
		if (!undoData || !undoData.originalStyles || !undoData.globalStylesId) {
			return { success: false, message: "No undo data available for global styles" };
		}

		const { originalStyles, globalStylesId } = undoData;
		const { editEntityRecord } = dispatch(coreStore);

		try {
			// Restore the original settings
			editEntityRecord("root", "globalStyles", globalStylesId, {
				settings: originalStyles,
			});

			return {
				success: true,
				message: "Global styles restored successfully",
			};
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("Failed to restore global styles:", error);
			return {
				success: false,
				message: `Failed to restore global styles: ${error.message}`,
			};
		}
	}
}

// Create and export a singleton instance
const actionExecutor = new ActionExecutor();
export default actionExecutor;
