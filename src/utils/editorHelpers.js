/**
 * WordPress dependencies
 */
import { select, resolveSelect, dispatch } from "@wordpress/data";
import { serialize } from "@wordpress/blocks";

/**
 * Build a compact text representation of the block tree for AI context.
 *
 * Produces a human-readable indented tree with index paths, block names,
 * clientIds, and text previews. Template parts include area/slug metadata.
 * Selected blocks are marked with [SELECTED].
 *
 * @param {Array}      blocks             Top-level blocks from getBlocks()
 * @param {Array|null} selectedClientIds  Array of clientIds of the currently selected blocks
 * @return {string} Compact block tree text
 */
export const buildCompactBlockTree = ( blocks, selectedClientIds = null ) => {
	const lines = [];
	const selectedSet = new Set( selectedClientIds || [] );

	const extractTextPreview = ( block ) => {
		// Try common text attributes first
		const content = block.attributes?.content;
		if ( content ) {
			const plain = content.replace( /<[^>]*>/g, '' ).trim();
			if ( plain ) {
				return plain.length > 50 ? plain.substring( 0, 50 ) + '…' : plain;
			}
		}

		// For blocks with metadata name
		const metaName = block.attributes?.metadata?.name;
		if ( metaName ) {
			return metaName;
		}

		// For blocks with alt text (images)
		const alt = block.attributes?.alt;
		if ( alt ) {
			return alt.length > 50 ? alt.substring( 0, 50 ) + '…' : alt;
		}

		return null;
	};

	const walkBlocks = ( blockList, prefix = '', depth = 0 ) => {
		blockList.forEach( ( block, index ) => {
			const indexPath = prefix ? `${ prefix }.${ index }` : `${ index }`;
			const isSelected = selectedSet.has( block.clientId );
			const selectedMarker = isSelected ? ' [SELECTED]' : '';

			let line = `${ '  '.repeat( depth ) }[${ indexPath }] ${ block.name } (id:${ block.clientId })`;

			// Add template part metadata
			if ( block.name === 'core/template-part' ) {
				const area = block.attributes?.area || '';
				const slug = block.attributes?.slug || '';
				if ( area ) {
					line += ` area:${ area }`;
				}
				if ( slug ) {
					line += ` slug:${ slug }`;
				}
			}

			// Add text preview
			const preview = extractTextPreview( block );
			if ( preview ) {
				line += ` → "${ preview }"`;
			}

			line += selectedMarker;
			lines.push( line );

			// Recurse into inner blocks
			if ( block.innerBlocks && block.innerBlocks.length > 0 ) {
				walkBlocks( block.innerBlocks, indexPath, depth + 1 );
			}
		} );
	};

	walkBlocks( blocks );
	return lines.join( '\n' );
};

/**
 * Get the full serialized markup of a block by its clientId.
 *
 * Used by the blu/get-block-markup tool interception for instant client-side response.
 *
 * @param {string} clientId The block's clientId
 * @return {Object|null} Object with block_content, block_name, client_id, or null if not found
 */
export const getBlockMarkup = ( clientId ) => {
	const blockEditor = select( 'core/block-editor' );
	const block = blockEditor.getBlock( clientId );

	if ( ! block ) {
		return null;
	}

	// Template parts serialize to a self-closing comment (<!-- wp:template-part /-->).
	// The AI needs the actual inner blocks content to be able to modify it.
	let blockContent;
	if ( block.name === 'core/template-part' ) {
		const innerBlocks = blockEditor.getBlocks( clientId );
		blockContent = innerBlocks.map( ( b ) => serialize( b ) ).join( '\n' );
	} else {
		blockContent = serialize( block );
	}

	return {
		block_content: blockContent,
		block_name: block.name,
		client_id: clientId,
	};
};

/**
 * Get the current page content
 *
 * @return {Promise<Object>} The page content with template parts
 */
export const getCurrentPageContent = async () => {
	const postContent = getPostContent();
	const templatePartBlocks = getAllTemplatePartBlocks();
	const templatePartsMap = await buildTemplatePartsMap(templatePartBlocks);

	return { page_content: postContent, ...templatePartsMap };
};

// Helpers
const getPostContent = () => {
	const blockEditor = select("core/block-editor");
	const blocks = blockEditor.getBlocks();

	// Find the post-content block
	const postContentBlock = blocks.find((block) => block.name === "core/post-content");

	if (!postContentBlock) {
		// If there's no post-content block, map all blocks
		return blocks.map((block) => ({
			clientId: block.clientId,
			content: serialize(block),
		}));
	}

	// Get inner blocks of the post-content block
	const innerBlocks = blockEditor.getBlocks(postContentBlock.clientId);

	// Map each inner block to the required structure
	return innerBlocks.map((block) => ({
		clientId: block.clientId,
		content: serialize(block),
	}));
};

const getAllTemplatePartBlocks = () => {
	const blockEditor = select("core/block-editor");
	const blocks = blockEditor.getBlocks();
	return blocks.filter((b) => b.name === "core/template-part");
};

/**
 * Fetch template part content from entity
 * This ensures we use the same content format that's sent as context to the AI
 *
 * @param {Object} tplBlock    The template part block
 * @param {Object} coreResolve Optional core resolve selector (will be created if not provided)
 * @return {Promise<string>}   The template part content as HTML string
 */
export const fetchTemplatePartContent = async (tplBlock, coreResolve = null) => {
	if (!tplBlock || !tplBlock.attributes) {
		return "";
	}
	const { ref, slug, theme } = tplBlock.attributes;

	// Use provided coreResolve or create a new one
	const resolve = coreResolve || resolveSelect("core");

	if (ref) {
		const rec = await resolve.getEntityRecord("postType", "wp_template_part", ref);
		return (rec && rec.content && (rec.content.raw || rec.content.rendered)) || "";
	}

	if (slug && theme) {
		const compositeId = `${theme}//${slug}`;
		const recByComposite = await resolve.getEntityRecord(
			"postType",
			"wp_template_part",
			compositeId
		);
		if (recByComposite && recByComposite.content) {
			return recByComposite.content.raw || recByComposite.content.rendered || "";
		}
	}

	if (slug) {
		const query = theme ? { slug: [slug], theme } : { slug: [slug] };
		const recs = await resolve.getEntityRecords("postType", "wp_template_part", query);
		if (Array.isArray(recs) && recs.length > 0) {
			const exact = recs.find((r) => r && r.slug === slug && (!theme || r.theme === theme));
			const rec = exact || recs[0];
			return (rec && rec.content && (rec.content.raw || rec.content.rendered)) || "";
		}
	}

	return "";
};

const pickTemplatePartKey = (attrs, index) => {
	return (
		attrs.slug || (attrs.ref ? String(attrs.ref) : null) || attrs.area || `template_part_${index}`
	);
};

const buildTemplatePartsMap = async (templatePartBlocks) => {
	const coreResolve = resolveSelect("core");

	const result = {};
	for (let i = 0; i < templatePartBlocks.length; i++) {
		const block = templatePartBlocks[i];
		const attrs = block.attributes || {};
		const html = await fetchTemplatePartContent(block, coreResolve);

		const key = pickTemplatePartKey(attrs, i);
		if (key && !result[key]) {
			result[key] = {
				clientId: block.clientId,
				content: html,
			};
		}
	}

	return result;
};

/**
 * Get the current page blocks
 *
 * @return {Object} The page blocks
 */
export const getCurrentPageBlocks = () => {
	const blockEditor = select("core/block-editor");

	const blocks = blockEditor.getBlocks();

	// Process blocks to get inner content for post-content and template-part blocks
	const processedBlocks = blocks.map((block) => {
		if (block.name === "core/post-content" || block.name === "core/template-part") {
			return {
				...block,
				innerBlocks: blockEditor.getBlocks(block.clientId),
			};
		}
		return block;
	});

	return processedBlocks;
};

/**
 * Get the current page ID
 *
 * @return {number} The page ID
 */
export const getCurrentPageId = () => {
	const editor = select("core/editor");
	return editor.getCurrentPostId();
};

/**
 * Get the current page title
 *
 * @return {string} The page title
 */
export const getCurrentPageTitle = () => {
	const editor = select("core/editor");
	return editor.getEditedPostAttribute("title") || "";
};

/**
 * Get all currently selected blocks.
 *
 * Handles both single selection (click) and multi-selection (shift+click).
 * Returns an array of block objects — empty array if nothing is selected.
 *
 * @return {Array} Array of selected block objects (may be empty)
 */
export const getSelectedBlocks = () => {
	const blockEditor = select("core/block-editor");

	// Multi-selection (shift+click range)
	const multiSelected = blockEditor.getMultiSelectedBlocks();
	if (multiSelected && multiSelected.length > 0) {
		return multiSelected;
	}

	// Single selection
	const single = blockEditor.getSelectedBlock();
	return single ? [single] : [];
};

/**
 * Get a single selected block (legacy helper).
 *
 * @return {Object|null} The selected block or null
 */
export const getSelectedBlock = () => {
	const blocks = getSelectedBlocks();
	return blocks.length > 0 ? blocks[0] : null;
};

/**
 * Check if a block is a template part
 *
 * @param {Object} block The block to check
 * @return {boolean} True if the block is a template part
 */
export const isTemplatePart = (block) => {
	return block && block.name === "core/template-part";
};

/**
 * Get template part entity record
 * This is the base function that other template part helpers use
 *
 * @param {Object} tplBlock The template part block
 * @return {Promise<Object|null>} The entity record
 */
export const getTemplatePartEntity = async (tplBlock) => {
	if (!tplBlock || !tplBlock.attributes) {
		return null;
	}

	const { ref, slug, theme } = tplBlock.attributes;
	const coreResolve = resolveSelect("core");

	// If we have a ref, use it directly
	if (ref) {
		return await coreResolve.getEntityRecord("postType", "wp_template_part", ref);
	}

	// Try composite ID (theme//slug)
	if (slug && theme) {
		const compositeId = `${theme}//${slug}`;
		const rec = await coreResolve.getEntityRecord("postType", "wp_template_part", compositeId);
		if (rec) {
			return rec;
		}
	}

	// Try by slug
	if (slug) {
		const query = theme ? { slug: [slug], theme } : { slug: [slug] };
		const recs = await coreResolve.getEntityRecords("postType", "wp_template_part", query);
		if (Array.isArray(recs) && recs.length > 0) {
			const exact = recs.find((r) => r && r.slug === slug && (!theme || r.theme === theme));
			return exact || recs[0];
		}
	}

	return null;
};

/**
 * Get template part entity record ID
 *
 * @param {Object} tplBlock The template part block
 * @return {Promise<string|number|null>} The entity record ID
 */
export const getTemplatePartEntityId = async (tplBlock) => {
	// Use ref directly if available
	if (tplBlock?.attributes?.ref) {
		return tplBlock.attributes.ref;
	}

	// Otherwise get the full entity and extract the ID
	const entity = await getTemplatePartEntity(tplBlock);
	return entity?.id || null;
};

/**
 * Update template part content
 *
 * @param {Object} tplBlock           The template part block
 * @param {Array}  updatedInnerBlocks The updated inner blocks
 * @return {Promise<Object>}          Result of the update
 */
export const updateTemplatePartContent = async (tplBlock, updatedInnerBlocks) => {
	try {
		const entityId = await getTemplatePartEntityId(tplBlock);

		if (!entityId) {
			throw new Error("Could not resolve template part entity ID");
		}

		// Serialize the updated blocks to HTML
		const updatedContent = updatedInnerBlocks.map((block) => serialize(block)).join("");

		// Get the core dispatcher
		const coreDispatch = dispatch("core");

		// Edit the entity record
		await coreDispatch.editEntityRecord("postType", "wp_template_part", entityId, {
			content: updatedContent,
		});

		// Save the entity
		const savedRecord = await coreDispatch.saveEditedEntityRecord(
			"postType",
			"wp_template_part",
			entityId
		);

		return {
			success: true,
			message: "Template part updated successfully",
			entityId,
			savedRecord,
		};
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error updating template part:", error);
		return {
			success: false,
			message: `Failed to update template part: ${error.message}`,
			error,
		};
	}
};
