/* eslint-disable no-undef */
/**
 * Tool executor — handles MCP/client-side tool calls from the AI.
 *
 * Extracted from useEditorChat.js so the hook stays a slim orchestrator.
 * Receives a `ctx` object with all the clients, state setters, refs, and
 * helpers it needs — no direct React dependency.
 */
import { CHAT_STATUS } from "@newfold-labs/wp-module-ai-chat";
import { __ } from "@wordpress/i18n";

import {
	handleRewriteAction,
	handleDeleteAction,
	handleAddAction,
	handleMoveAction,
} from "./actionExecutor";
import {
	findAncestorTemplatePart,
	getBlockPathInTemplatePart,
	modifyTemplatePartEntity,
	insertBlocksAtPath,
	insertBlocksBeforePath,
	appendBlocksAsChildAtPath,
} from "./templatePartEditor";
import { getCurrentGlobalStyles, updateGlobalStyles } from "./globalStylesService";
import patternLibrary from "./patternLibrary";
import { customizePatternContent } from "./patternCustomizer";
import { getBlockMarkup, getCurrentPageTitle } from "../utils/editorHelpers";
import { validateBlockMarkup } from "../utils/blockValidator";
import { snapshotBlocks } from "../utils/editorContext";

/**
 * Module-level tracker for the last successful pattern search results.
 * Used by code-level enforcement: when the AI calls blu-edit-block or
 * blu-add-section with its own block_content instead of pattern_slug,
 * we auto-substitute the top search result's slug so the pattern library
 * markup is used (with text customization) instead of broken AI-generated HTML.
 */
let lastPatternSearchResults = null;

/** Block-mutating tool names that require a snapshot for undo. */
const BLOCK_TOOL_NAMES = [
	"blu-edit-block",
	"blu-add-section",
	"blu-delete-block",
	"blu-move-block",
	"blu-rewrite-text",
	"blu-update-block-attrs",
	"blu-replace-image",
	"blu-update-text",
	"blu-duplicate-block",
	"blu-batch-update-attrs",
	"blu-insert-block",
];


/**
 * Replace image URLs in pattern markup with provided URLs (e.g. from search_images).
 *
 * Collects all unique image URLs from the pattern (block comment attrs, img src,
 * background-image) and replaces them in order with the provided URLs.
 * Works for core/image, core/cover, and any block with image URLs.
 */
function replacePatternImages(markup, imageUrls) {
	if (!imageUrls || imageUrls.length === 0) return markup;

	const existingUrls = [];
	const seen = new Set();
	const IMAGE_BLOCKS = new Set(["core/image", "core/cover", "core/media-text"]);

	// 1. Parse blocks and extract "url" from image-bearing block attrs only.
	//    This avoids social-link, navigation-link, embed, etc.
	try {
		const blocks = wp.blocks.parse(markup);
		(function walk(list) {
			for (const b of list) {
				if (IMAGE_BLOCKS.has(b.blockName || b.name)) {
					const url = (b.attrs || b.attributes || {}).url;
					if (url && !seen.has(url)) {
						seen.add(url);
						existingUrls.push(url);
					}
				}
				if (b.innerBlocks?.length) walk(b.innerBlocks);
			}
		})(blocks);
	} catch {
		// Parse failed — rely on regex below
	}

	// 2. Collect <img src="..."> URLs (always image-specific)
	let match;
	const srcRegex = /\bsrc="([^"]+)"/g;
	while ((match = srcRegex.exec(markup)) !== null) {
		const url = match[1];
		if (url && !seen.has(url) && (url.startsWith("http") || url.startsWith("//"))) {
			seen.add(url);
			existingUrls.push(url);
		}
	}

	// 3. Collect background-image: url(...) (CSS backgrounds)
	const bgRegex = /background-image:\s*url\(([^)]+)\)/g;
	while ((match = bgRegex.exec(markup)) !== null) {
		const url = match[1];
		if (url && !seen.has(url) && (url.startsWith("http") || url.startsWith("//"))) {
			seen.add(url);
			existingUrls.push(url);
		}
	}

	// Replace each existing URL with the corresponding new one
	let result = markup;
	for (let i = 0; i < Math.min(existingUrls.length, imageUrls.length); i++) {
		result = result.replaceAll(existingUrls[i], imageUrls[i]);
	}

	return result;
}

// ────────────────────────────────────────────────────────────────────
// Individual tool handlers
// ────────────────────────────────────────────────────────────────────

async function handleUpdateGlobalStyles(toolCall, args, ctx) {
	await ctx.updateProgress(__("Reading current styles…", "wp-module-editor-chat"), 500);

	// Validate palette items — filter out corrupt entries from truncated responses
	try {
		for (const key of ["theme", "custom"]) {
			const palette = args.settings?.color?.palette?.[key];
			if (Array.isArray(palette)) {
				const cleaned = palette.filter((p) => p && p.slug && p.color);
				if (cleaned.length < palette.length) {
					args.settings.color.palette[key] = cleaned;
				}
			}
		}
	} catch { /* non-critical */ }

	try {
		await ctx.updateProgress(
			__("Applying style changes to your site…", "wp-module-editor-chat"),
			600
		);
		const jsResult = await updateGlobalStyles(args.settings, args.styles);

		if (jsResult.success) {
			await ctx.updateProgress(
				__("✓ Styles updated! Review and Accept or Decline.", "wp-module-editor-chat"),
				800
			);
			ctx.setHasGlobalStylesChanges(true);

			if (jsResult.undoData && !ctx.originalGlobalStylesRef.current) {
				ctx.originalGlobalStylesRef.current = jsResult.undoData;
			}
			const globalStylesUndoData = ctx.originalGlobalStylesRef.current || null;

			const { undoData: _unused, ...resultForAI } = jsResult;
			return {
				toolResult: {
					id: toolCall.id,
					result: [{ type: "text", text: JSON.stringify(resultForAI) }],
					isError: false,
					hasChanges: true,
				},
				globalStylesUndoData,
			};
		}
		await ctx.updateProgress(__("Retrying with alternative method…", "wp-module-editor-chat"), 400);
	} catch {
		await ctx.updateProgress(__("Retrying with alternative method…", "wp-module-editor-chat"), 400);
	}

	// Fallback to MCP
	const result = await ctx.mcpClient.callTool(toolCall.name, toolCall.arguments);
	return {
		toolResult: {
			id: toolCall.id,
			result: result.content,
			isError: result.isError,
		},
		globalStylesUndoData: null,
	};
}

async function handleGetGlobalStyles(toolCall, ctx) {
	await ctx.updateProgress(__("Reading site color palette…", "wp-module-editor-chat"), 500);

	try {
		await ctx.updateProgress(__("Analyzing theme settings…", "wp-module-editor-chat"), 600);
		const jsResult = getCurrentGlobalStyles();

		if (jsResult.palette?.length > 0 || jsResult.rawSettings) {
			const colorCount = jsResult.palette?.length || 0;
			await ctx.updateProgress(`✓ Found ${colorCount} colors in palette`, 700);
			return {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({
							styles: jsResult,
							message: "Retrieved global styles from editor",
						}),
					},
				],
				isError: false,
			};
		}
		await ctx.updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
	} catch {
		await ctx.updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
	}

	// Fall through — caller will hit the default MCP path
	return null;
}

// ────────────────────────────────────────────────────────────────────
// Safe block-edit helpers
//
// The AI frequently rewrites entire block trees when only wrapper
// attributes (background-color, text-color, spacing) changed.  This
// causes WordPress block-validation failures and strips inner blocks.
//
// When the AI's replacement has the SAME inner-block structure (names
// and nesting) as the original, we take a safe path: extract the AI's
// attributes at every level and merge them into the ORIGINAL block
// tree.  Inner blocks are never at risk.
// ────────────────────────────────────────────────────────────────────

/**
 * Count all inner blocks recursively.
 *
 * @param {Object} block A parsed or editor block object.
 * @return {number} Total number of inner blocks (all levels).
 */
function countInnerBlocks(block) {
	if (!block.innerBlocks || block.innerBlocks.length === 0) {
		return 0;
	}
	return block.innerBlocks.reduce((sum, ib) => sum + 1 + countInnerBlocks(ib), 0);
}

/**
 * Deep-merge source into target. Null values remove the key.
 * Arrays and non-plain-objects are replaced, not merged.
 */
function deepMerge(target, source) {
	const result = { ...target };
	for (const key of Object.keys(source)) {
		if (source[key] === null || source[key] === undefined) {
			delete result[key];
		} else if (
			typeof source[key] === "object" &&
			!Array.isArray(source[key]) &&
			typeof result[key] === "object" &&
			result[key] !== null &&
			!Array.isArray(result[key])
		) {
			result[key] = deepMerge(result[key], source[key]);
		} else {
			result[key] = source[key];
		}
	}
	return result;
}

async function handleUpdateBlockAttrs(toolCall, args, ctx) {
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const block = blockEditor.getBlock(args.client_id);

	if (!block) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) }],
			isError: true,
		};
	}

	try {
		// Deep-merge new attributes into existing ones (null removes keys)
		const merged = deepMerge(block.attributes, args.attributes);
		wpDispatch("core/block-editor").updateBlockAttributes(args.client_id, merged);

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: true, message: "Attributes updated" }) }],
			isError: false,
			hasChanges: true,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}

async function handleReplaceImage(toolCall, args, ctx) {
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const block = wpSelect("core/block-editor").getBlock(args.client_id);

	if (!block) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) }],
			isError: true,
		};
	}

	try {
		const newAttrs = { url: args.url };
		if (args.alt !== undefined) {
			newAttrs.alt = args.alt;
		}

		// For core/image, also set id to 0 to indicate an external image
		if (block.name === "core/image") {
			newAttrs.id = 0;
		}

		wpDispatch("core/block-editor").updateBlockAttributes(args.client_id, newAttrs);

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: true, message: "Image replaced" }) }],
			isError: false,
			hasChanges: true,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}

async function handleUpdateText(toolCall, args, ctx) {
	const { select: wpSelect } = wp.data;
	const block = wpSelect("core/block-editor").getBlock(args.client_id);

	if (!block) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) }],
			isError: true,
		};
	}

	try {
		// Serialize the block to get its current markup
		const { serialize, parse } = wp.blocks;
		const currentMarkup = serialize(block);

		// Strip HTML tags to get old text, then replace in the original markup
		const stripTags = (html) => html.replace(/<[^>]+>/g, "").trim();
		const oldText = stripTags(currentMarkup);
		if (!oldText) {
			return {
				id: toolCall.id,
				result: [{ type: "text", text: JSON.stringify({ success: false, error: "Block has no text content" }) }],
				isError: true,
			};
		}

		const newMarkup = currentMarkup.replace(oldText, args.text.trim());

		// Apply via rewrite action
		const editResult = await handleRewriteAction(args.client_id, newMarkup);

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(editResult) }],
			isError: !editResult.success,
			hasChanges: editResult.success,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}

async function handleDuplicateBlock(toolCall, args, ctx) {
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const block = blockEditor.getBlock(args.client_id);

	if (!block) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) }],
			isError: true,
		};
	}

	try {
		const { serialize, parse } = wp.blocks;
		// Serialize and re-parse to create a deep clone with fresh clientIds
		const markup = serialize(block);
		const clonedBlocks = parse(markup);

		if (!clonedBlocks || clonedBlocks.length === 0) {
			return {
				id: toolCall.id,
				result: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to clone block" }) }],
				isError: true,
			};
		}

		// Find the position to insert after the original
		const rootClientId = blockEditor.getBlockRootClientId(args.client_id);
		const blockIndex = blockEditor.getBlockIndex(args.client_id);

		wpDispatch("core/block-editor").insertBlocks(
			clonedBlocks,
			blockIndex + 1,
			rootClientId
		);

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: true, message: "Block duplicated" }) }],
			isError: false,
			hasChanges: true,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}

async function handleBatchUpdateAttrs(toolCall, args, ctx) {
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const results = [];

	try {
		for (const update of args.updates) {
			const block = blockEditor.getBlock(update.client_id);
			if (!block) {
				results.push({ client_id: update.client_id, success: false, error: "Block not found" });
				continue;
			}
			const merged = deepMerge(block.attributes, update.attributes);
			wpDispatch("core/block-editor").updateBlockAttributes(update.client_id, merged);
			results.push({ client_id: update.client_id, success: true });
		}

		const allOk = results.every((r) => r.success);
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: allOk, results }) }],
			isError: false,
			hasChanges: true,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}

async function handleInsertBlock(toolCall, args, ctx) {
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const blockEditor = wpSelect("core/block-editor");

	try {
		const { createBlock } = wp.blocks;
		const attrs = args.attributes || {};

		// For text blocks, set content attribute
		if (args.content) {
			const textAttrMap = {
				"core/heading": "content",
				"core/paragraph": "content",
				"core/button": "text",
				"core/list-item": "content",
				"core/verse": "content",
				"core/preformatted": "content",
				"core/code": "content",
				"core/pullquote": "value",
			};
			const contentAttr = textAttrMap[args.block_name];
			if (contentAttr) {
				attrs[contentAttr] = args.content;
			}
		}

		const newBlock = createBlock(args.block_name, attrs);
		if (!newBlock) {
			return {
				id: toolCall.id,
				result: [{ type: "text", text: JSON.stringify({ success: false, error: `Unknown block type: ${args.block_name}` }) }],
				isError: true,
			};
		}

		// Determine insertion position
		const refId = args.after_client_id || args.before_client_id;
		const isAfter = !!args.after_client_id;

		// Detect column-into-columns nesting: when inserting core/column and
		// the reference block is core/columns, append as a child instead of
		// inserting as a sibling (which would place it outside the columns).
		const refBlock = refId ? blockEditor.getBlock(refId) : null;
		const shouldAppendAsChild =
			args.block_name === "core/column" &&
			refBlock?.name === "core/columns";

		// Check if the reference block is inside a template part (header/footer)
		const ancestorTP = refId ? findAncestorTemplatePart(refId) : null;

		if (ancestorTP) {
			// Template part insertion — use entity-level editing
			const path = getBlockPathInTemplatePart(ancestorTP.clientId, refId);
			if (!path) {
				return {
					id: toolCall.id,
					result: [{ type: "text", text: JSON.stringify({ success: false, error: "Could not locate block inside template part" }) }],
					isError: true,
				};
			}
			const serialized = wp.blocks.serialize(newBlock);
			const parsed = wp.blocks.parse(serialized);
			await modifyTemplatePartEntity(ancestorTP, (blocks) => {
				if (shouldAppendAsChild) {
					return appendBlocksAsChildAtPath(blocks, path, parsed);
				}
				return isAfter
					? insertBlocksAtPath(blocks, path, parsed)
					: insertBlocksBeforePath(blocks, path, parsed);
			});
		} else {
			if (shouldAppendAsChild) {
				// Insert as last child of the columns block
				const childCount = refBlock.innerBlocks?.length || 0;
				wpDispatch("core/block-editor").insertBlocks(
					[newBlock],
					childCount,
					refId
				);
			} else {
				let rootClientId = "";
				let insertIndex;
				if (refId) {
					rootClientId = blockEditor.getBlockRootClientId(refId) || "";
					const refIndex = blockEditor.getBlockIndex(refId);
					insertIndex = isAfter ? refIndex + 1 : refIndex;
				}
				wpDispatch("core/block-editor").insertBlocks(
					[newBlock],
					insertIndex,
					rootClientId
				);
			}
		}

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: true, message: "Block inserted", client_id: newBlock.clientId }) }],
			isError: false,
			hasChanges: true,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}

async function handleRewriteText(toolCall, args, ctx) {
	await ctx.updateProgress(__("Rewriting text…", "wp-module-editor-chat"), 300);

	const clientId = args.client_id;
	const instructions = args.instructions;

	// Get the block's full markup (including inner blocks)
	const mkData = getBlockMarkup(clientId);
	if (!mkData) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) }],
			isError: true,
		};
	}

	const originalMarkup = mkData.block_content;
	const pageTitle = getCurrentPageTitle();

	try {
		const rewritten = await customizePatternContent(originalMarkup, {
			pageTitle,
			userMessage: instructions,
		});

		if (rewritten === originalMarkup) {
			return {
				id: toolCall.id,
				result: [{ type: "text", text: JSON.stringify({ success: true, message: "No text changes needed" }) }],
				isError: false,
			};
		}

		// Apply the rewritten markup back to the block
		const editResult = await handleRewriteAction(clientId, rewritten);

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(editResult) }],
			isError: !editResult.success,
			hasChanges: editResult.success,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}

async function handleEditBlock(toolCall, args, ctx) {
	// When pattern_slug is provided, fetch markup from the library first.
	if (args.pattern_slug && !args.block_content) {
		await ctx.updateProgress(__("Fetching pattern from library…", "wp-module-editor-chat"), 400);
		try {
			const pattern = await patternLibrary.getMarkup(args.pattern_slug);
			if (pattern && pattern.content) {
				let markup = pattern.content;

				// Replace placeholder images with provided URLs if any
				if (args.image_urls && Array.isArray(args.image_urls) && args.image_urls.length > 0) {
					markup = replacePatternImages(markup, args.image_urls);
				}

				// Customize text via the backend AI before inserting
				await ctx.updateProgress(__("Customizing content for your site…", "wp-module-editor-chat"), 500);
				try {
					const lastUserMsg = ctx.getMessages?.()
						?.filter((m) => m.role === "user")
						?.pop()?.content || "";
					args.block_content = await customizePatternContent(markup, {
						pageTitle: getCurrentPageTitle(),
						userMessage: lastUserMsg,
					});
				} catch {
					args.block_content = markup;
				}
			} else {
				return {
					id: toolCall.id,
					result: [{ type: "text", text: JSON.stringify({ success: false, error: `Pattern "${args.pattern_slug}" not found` }) }],
					isError: true,
				};
			}
		} catch (fetchErr) {
			return {
				id: toolCall.id,
				result: [{ type: "text", text: JSON.stringify({ success: false, error: fetchErr.message }) }],
				isError: true,
			};
		}
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	// ── Guard: reject full-section rewrites on complex blocks ──
	// When the model sends huge markup targeting a block with many inner blocks,
	// it almost always produces truncated/broken HTML. Reject early and guide
	// the model to use targeted tools (blu-rewrite-text, blu-update-block-attrs).
	{
		const { select: wpSel } = wp.data;
		const targetBlock = wpSel("core/block-editor").getBlock(args.client_id);
		if (targetBlock) {
			const innerCount = countInnerBlocks(targetBlock);
			if (innerCount >= 5 && args.block_content.length > 2000) {
				console.warn(
					`[ToolExecutor] Rejecting large edit-block rewrite: ${args.block_content.length} chars targeting block with ${innerCount} inner blocks`
				);
				return {
					id: toolCall.id,
					result: [{
						type: "text",
						text: JSON.stringify({
							success: false,
							error: `This block has ${innerCount} inner blocks — rewriting the entire markup will break it. Instead, call blu-rewrite-text with the client_id of the specific child block you want to change (from the page context) and an "instructions" string describing the change. blu-rewrite-text reads the block content automatically and rewrites it. Do NOT call blu-get-block-markup first — just call blu-rewrite-text directly.`,
						}),
					}],
					isError: true,
				};
			}
		}
	}

	const validation = validateBlockMarkup(args.block_content);
	if (!validation.valid) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) }],
			isError: true,
		};
	}

	let finalContent = validation.correctedContent || args.block_content;

	// ── Safe attribute-merge path ──
	// When the original block has inner blocks, protect them by merging
	// AI attributes into the original tree instead of full replacement.
	const { select: wpSelect } = wp.data;
	const originalBlock = wpSelect("core/block-editor").getBlock(args.client_id);

	if (originalBlock && originalBlock.innerBlocks.length > 0 && validation.blocks?.length >= 1) {
		const newTopBlock = validation.blocks[0];

		// ── Wrapper/child mismatch recovery ──
		// The AI may target a wrapper block (e.g., core/buttons) but send
		// content for an inner block (e.g., core/button). When the original
		// has exactly one inner block matching the AI's block type, redirect
		// the edit to that inner block to avoid replacing the wrapper.
		if (
			newTopBlock.name !== originalBlock.name &&
			originalBlock.innerBlocks.length === 1 &&
			originalBlock.innerBlocks[0].name === newTopBlock.name
		) {
			const innerBlock = originalBlock.innerBlocks[0];
			args.client_id = innerBlock.clientId;
			// Inner block has no further inner blocks — skip safe merge, use
			// full replacement path below.
		} else {
			// Structure changed — reject if inner blocks were lost
			const origCount = countInnerBlocks(originalBlock);
			const newCount = countInnerBlocks(newTopBlock);

			if (origCount >= 2 && newCount === 0) {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `STRUCTURAL ERROR: The replacement markup has 0 inner blocks but the original has ${origCount}. You MUST preserve all inner blocks when editing a wrapper block. To change only wrapper attributes, modify the block comment JSON and copy all inner blocks from the original markup.`,
							}),
						},
					],
					isError: true,
				};
			}

			if (origCount >= 3 && newCount < origCount * 0.5) {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `STRUCTURAL ERROR: The replacement markup has ${newCount} inner blocks but the original has ${origCount}. You appear to have lost inner blocks. Preserve all inner blocks — only change what the user asked for.`,
							}),
						},
					],
					isError: true,
				};
			}
			// Structure intentionally changed (different block types, reordering)
			// — fall through to full replacement
		}
	}

	// ── Apply the edit ──
	await ctx.updateProgress(__("Editing block content…", "wp-module-editor-chat"), 400);
	try {
		const editResult = await handleRewriteAction(args.client_id, finalContent);
		await ctx.updateProgress(__("Block updated successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: true, message: editResult.message }),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (editError) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: false, error: editError.message }),
				},
			],
			isError: true,
		};
	}
}

async function handleAddSection(toolCall, args, ctx) {
	// Track whether a pattern was used so we can inform the AI in the result
	let usedPatternTitle = null;

	// When pattern_slug is provided, fetch markup, customize text via backend AI, then insert.
	if (args.pattern_slug && !args.block_content) {
		await ctx.updateProgress(__("Fetching pattern from library…", "wp-module-editor-chat"), 400);
		try {
			const pattern = await patternLibrary.getMarkup(args.pattern_slug);
			if (pattern && pattern.content) {
				usedPatternTitle = pattern.title || args.pattern_slug;

				let markup = pattern.content;

				// Replace placeholder images with search_images URLs if provided
				if (args.image_urls && Array.isArray(args.image_urls) && args.image_urls.length > 0) {
					markup = replacePatternImages(markup, args.image_urls);
				}

				// Customize text via the backend AI before inserting
				await ctx.updateProgress(__("Customizing content for your site…", "wp-module-editor-chat"), 500);
				try {
					const lastUserMsg = ctx.getMessages?.()
						?.filter((m) => m.role === "user")
						?.pop()?.content || "";
					args.block_content = await customizePatternContent(markup, {
						pageTitle: getCurrentPageTitle(),
						userMessage: lastUserMsg,
					});
				} catch {
					args.block_content = markup;
				}
			} else {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `Pattern "${args.pattern_slug}" not found`,
							}),
						},
					],
					isError: true,
				};
			}
		} catch (fetchErr) {
			return {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({ success: false, error: fetchErr.message }),
					},
				],
				isError: true,
			};
		}
	}

	// Replace __IMG_N__ placeholders with real URLs from image_urls (for AI-generated markup)
	if (args.image_urls && Array.isArray(args.image_urls) && args.image_urls.length > 0) {
		for (let i = 0; i < args.image_urls.length; i++) {
			args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, args.image_urls[i]);
		}
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	const validation = validateBlockMarkup(args.block_content);
	if (!validation.valid) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) }],
			isError: true,
		};
	}

	// Use auto-corrected content if the validator fixed class order / missing meta-classes
	const finalAddContent = validation.correctedContent || args.block_content;

	// Force constrained layout on the outermost block comment
	let sectionContent = finalAddContent;
	try {
		const commentEnd = sectionContent.indexOf("-->");
		if (commentEnd !== -1) {
			const comment = sectionContent.substring(0, commentEnd + 3);
			const nameMatch = comment.match(/<!-- wp:(\S+)/);
			if (nameMatch) {
				const blockName = nameMatch[1];
				const braceStart = comment.indexOf("{");
				const braceEnd = comment.lastIndexOf("}");

				let attrs = {};
				if (braceStart !== -1 && braceEnd > braceStart) {
					attrs = JSON.parse(comment.substring(braceStart, braceEnd + 1));
				}

				if (!attrs.layout) {
					attrs.layout = { type: "constrained" };
					const newComment = `<!-- wp:${blockName} ${JSON.stringify(attrs)} -->`;
					sectionContent = newComment + sectionContent.substring(commentEnd + 3);
				}
			}
		}
	} catch {
		// Non-critical — proceed without constrained layout
	}

	await ctx.updateProgress(__("Adding new section…", "wp-module-editor-chat"), 400);
	try {
		const afterClientId = args.after_client_id || null;
		const addResult = await handleAddAction(afterClientId, [{ block_content: sectionContent }]);
		await ctx.updateProgress(__("Section added successfully", "wp-module-editor-chat"), 500);

		const resultData = {
			success: true,
			message: addResult.message,
			blocksAdded: addResult.blocksAdded,
		};
		if (usedPatternTitle) {
			resultData.patternUsed = usedPatternTitle;
			resultData.note =
				`A matching design "${usedPatternTitle}" was found in the pattern library and the text was automatically customized to fit the site. ` +
				"Tell the user you found a matching design in the library and customized the content for their site.";
		}

		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify(resultData),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (addError) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: addError.message }) }],
			isError: true,
		};
	}
}

async function handleDeleteBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Deleting block…", "wp-module-editor-chat"), 400);
	try {
		const deleteResult = await handleDeleteAction(args.client_id);
		await ctx.updateProgress(__("Block deleted successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: true, message: deleteResult.message }),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (deleteError) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: false, error: deleteError.message }),
				},
			],
			isError: true,
		};
	}
}

async function handleMoveBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Moving block…", "wp-module-editor-chat"), 400);
	try {
		const moveResult = await handleMoveAction(args.client_id, args.target_client_id, args.position);
		await ctx.updateProgress(__("Block moved successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: true, message: moveResult.message }),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (moveError) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({ success: false, error: moveError.message }),
				},
			],
			isError: true,
		};
	}
}

async function handleGetBlockMarkup(toolCall, args, ctx) {
	await ctx.updateProgress(__("Reading block markup…", "wp-module-editor-chat"), 300);
	const markupResult = getBlockMarkup(args.client_id);
	if (markupResult) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(markupResult) }],
			isError: false,
		};
	}
	return {
		id: toolCall.id,
		result: [
			{
				type: "text",
				text: JSON.stringify({
					error: `Block with clientId ${args.client_id} not found`,
				}),
			},
		],
		isError: true,
	};
}

async function handleHighlightBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Highlighting block…", "wp-module-editor-chat"), 300);
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const block = wpSelect("core/block-editor").getBlock(args.client_id);
	if (block) {
		wpDispatch("core/block-editor").selectBlock(args.client_id);
		wpDispatch("core/block-editor").flashBlock(args.client_id);
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: true, block_name: block.name }) }],
			isError: false,
		};
	}
	return {
		id: toolCall.id,
		result: [
			{
				type: "text",
				text: JSON.stringify({ error: `Block ${args.client_id} not found` }),
			},
		],
		isError: true,
	};
}

async function handleSearchPatterns(toolCall, args, ctx) {
	await ctx.updateProgress(__("Searching pattern library…", "wp-module-editor-chat"), 300);
	if (patternLibrary.isReady()) {
		const { results, totalMatches } = patternLibrary.search(args.query, {
			category: args.category,
			limit: args.limit || 15,
		});

		// Track successful search results for code-level enforcement.
		// When the model later calls edit-block/add-section with block_content
		// instead of pattern_slug, we auto-substitute the top result.
		if (results.length > 0) {
			lastPatternSearchResults = {
				results,
				query: args.query,
				timestamp: Date.now(),
			};
		}

		const resultText =
			results.length > 0
				? JSON.stringify({
						patterns: results,
						count: results.length,
						totalMatches,
					})
				: JSON.stringify({
						patterns: [],
						count: 0,
						totalMatches: 0,
						message: "No matching patterns found",
					});
		return {
			id: toolCall.id,
			result: [{ type: "text", text: resultText }],
			isError: false,
		};
	}
	// Fall through — caller will hit the default MCP path
	return null;
}

async function handleGetPatternMarkup(toolCall, args, ctx) {
	await ctx.updateProgress(__("Fetching pattern markup…", "wp-module-editor-chat"), 400);
	try {
		const pattern = await patternLibrary.getMarkup(args.slug);
		if (pattern && pattern.content) {
			return {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({
							slug: pattern.slug,
							title: pattern.title,
							content: pattern.content,
							categories: pattern.categories,
						}),
					},
				],
				isError: false,
			};
		}
	} catch {
		// Fall through to MCP path
	}
	// Fall through — caller will hit the default MCP path
	return null;
}

// ────────────────────────────────────────────────────────────────────
// WebSocket entry point (no follow-up AI call — Jarvis handles it)
// ────────────────────────────────────────────────────────────────────

/**
 * Execute tool calls received from the Jarvis WebSocket gateway.
 *
 * This function does NOT send a follow-up AI completion — Jarvis runs
 * tools server-side and generates the summary automatically. This
 * function only handles the client-side visual updates (block editing,
 * section adding, style changes, etc.).
 *
 * @param {Array}  toolCalls Tool calls parsed from the WebSocket `tool_call` event
 * @param {Object} ctx       Shared context object (same shape as useEditorChat's buildToolCtx)
 */
export async function executeToolCallsFromWebSocket(toolCalls, ctx) {
	// Filter out server-side-only tools (discovery, site listing, etc.).
	// These are already executed by Semantic Kernel on the backend —
	// the frontend only needs to handle client-side editor tools (blu-*).
	console.log("[ToolExecutor] Received tool calls:", toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments })));

	const clientToolCalls = toolCalls.filter((tc) => {
		const name = tc.name || "";
		if (!name.startsWith("blu-")) {
			console.log(`[ToolExecutor] Skipping non-client tool: ${name}`);
			return false;
		}
		return true;
	});

	if (clientToolCalls.length === 0) {
		console.log("[ToolExecutor] No client-side tools to execute");
		return;
	}

	// Replace toolCalls with the filtered list for the rest of this function
	toolCalls = clientToolCalls;

	const toolResults = [];
	const completedToolsList = [];
	let globalStylesUndoData = null;
	let hasBlockEdits = false;

	// Capture block snapshot before any tool execution for atomic undo
	const hasBlockTools = toolCalls.some((tc) => BLOCK_TOOL_NAMES.includes(tc.name || ""));
	if (hasBlockTools && !ctx.blockSnapshotRef.current) {
		const { select: wpSelect } = wp.data;
		const allBlocks = wpSelect("core/block-editor").getBlocks();
		ctx.blockSnapshotRef.current = snapshotBlocks(allBlocks);
	}

	// Brief pause before activating tool mode so the "Thinking…" indicator
	// stays visible between the reasoning text and the tool execution
	// accordion.  isTyping is kept true by the messageHandler so isLoading
	// remains true during this wait (no gap in the indicator).
	await ctx.wait(300);

	ctx.setStatus(CHAT_STATUS.TOOL_CALL);
	ctx.setActiveToolCall({
		id: "preparing",
		name: "preparing",
		index: 0,
		total: toolCalls.length,
	});

	ctx.setPendingTools(
		toolCalls.map((tc, idx) => ({
			...tc,
			id: tc.id || `tool-${idx}`,
		}))
	);

	for (let i = 0; i < toolCalls.length; i++) {
		const toolCall = toolCalls[i];
		const toolIndex = i + 1;
		const totalTools = toolCalls.length;

		ctx.setPendingTools((prev) => prev.filter((_, idx) => idx !== 0));
		ctx.setActiveToolCall({
			id: toolCall.id || `tool-${i}`,
			name: toolCall.name,
			arguments: toolCall.arguments,
			index: toolIndex,
			total: totalTools,
		});

		try {
			let toolName = toolCall.name || "";
			console.log(`[ToolExecutor] Executing ${toolIndex}/${totalTools}: ${toolName}`, toolCall.arguments);
			let args = toolCall.arguments || {};
			if (typeof args === "string") {
				try {
					args = JSON.parse(args);
				} catch (e) {
					// Trailing junk after valid JSON — extract the first complete {} object
					let recovered = false;
					let depth = 0;
					let inStr = false;
					let esc = false;
					for (let ci = 0; ci < args.length; ci++) {
						const ch = args[ci];
						if (esc) { esc = false; continue; }
						if (ch === "\\" && inStr) { esc = true; continue; }
						if (ch === '"') { inStr = !inStr; continue; }
						if (inStr) continue;
						if (ch === "{") depth++;
						if (ch === "}") {
							depth--;
							if (depth === 0) {
								try {
									args = JSON.parse(args.substring(0, ci + 1));
									recovered = true;
								} catch { /* ignore */ }
								break;
							}
						}
					}
					if (!recovered) {
						args = {};
					}
				}
			}

			// ── Pattern enforcement: prefer library patterns over AI-generated markup ──
			if (
				(toolName === "blu-edit-block" || toolName === "blu-add-section") &&
				args.block_content && !args.pattern_slug &&
				lastPatternSearchResults &&
				(Date.now() - lastPatternSearchResults.timestamp) < 120000 &&
				lastPatternSearchResults.results.length > 0
			) {
				const topPattern = lastPatternSearchResults.results[0];
				console.log(`[ToolExecutor] Auto-correcting: using pattern_slug "${topPattern.slug}" instead of AI-generated block_content`);
				args.pattern_slug = topPattern.slug;
				delete args.block_content;
				lastPatternSearchResults = null;
			}

			// edit-block without client_id → treat as add-section
			if (toolName === "blu-edit-block" && !args.client_id && (args.block_content || args.pattern_slug)) {
				console.log(`[ToolExecutor] Redirecting blu-edit-block → blu-add-section (no client_id)`);
				toolName = "blu-add-section";
			}

			// ── blu/update-global-styles ──
			if (toolName === "blu-update-global-styles" && args.settings) {
				console.log(`[ToolExecutor] update-global-styles args.settings:`, JSON.stringify(args.settings));
				const gsResult = await handleUpdateGlobalStyles(toolCall, args, ctx);
				const isError = gsResult.toolResult.isError;
				console.log(`[ToolExecutor] update-global-styles result:`, { isError, result: gsResult.toolResult.result });
				toolResults.push(gsResult.toolResult);
				completedToolsList.push({ ...toolCall, isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError }]);
				if (gsResult.globalStylesUndoData) {
					globalStylesUndoData = gsResult.globalStylesUndoData;
				}
			}

			// ── blu/get-global-styles ──
			else if (toolName === "blu-get-global-styles") {
				const gsResult = await handleGetGlobalStyles(toolCall, ctx);
				console.log(`[ToolExecutor] get-global-styles result:`, gsResult ? "ok" : "null");
				if (gsResult) {
					toolResults.push(gsResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				} else {
					toolResults.push({ id: toolCall.id, result: null, isError: false });
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				}
			}

			// ── blu/edit-block ──
			else if (toolName === "blu-edit-block" && args.client_id && (args.block_content || args.pattern_slug)) {
				const editResult = await handleEditBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] edit-block result:`, { isError: editResult.isError, hasChanges: editResult.hasChanges });
				if (!editResult.isError && editResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(editResult);
				completedToolsList.push({ ...toolCall, isError: editResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: editResult.isError }]);
			}

			// ── blu/add-section ──
			else if (toolName === "blu-add-section" && (args.block_content || args.pattern_slug)) {
				console.log(`[ToolExecutor] add-section args:`, { pattern_slug: args.pattern_slug, has_block_content: !!args.block_content, image_urls: args.image_urls });
				const addResult = await handleAddSection(toolCall, args, ctx);
				console.log(`[ToolExecutor] add-section result:`, { isError: addResult.isError, hasChanges: addResult.hasChanges });
				if (!addResult.isError && addResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(addResult);
				completedToolsList.push({ ...toolCall, isError: addResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: addResult.isError }]);
			}

			// ── blu/delete-block ──
			else if (toolName === "blu-delete-block" && args.client_id) {
				const delResult = await handleDeleteBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] delete-block result:`, { isError: delResult.isError, hasChanges: delResult.hasChanges, client_id: args.client_id });
				if (!delResult.isError && delResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(delResult);
				completedToolsList.push({ ...toolCall, isError: delResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: delResult.isError }]);
			}

			// ── blu/move-block ──
			else if (
				toolName === "blu-move-block" &&
				args.client_id &&
				args.target_client_id &&
				args.position
			) {
				const mvResult = await handleMoveBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] move-block result:`, { isError: mvResult.isError, hasChanges: mvResult.hasChanges });
				if (!mvResult.isError && mvResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(mvResult);
				completedToolsList.push({ ...toolCall, isError: mvResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: mvResult.isError }]);
			}

			// ── blu/get-block-markup ──
			else if (toolName === "blu-get-block-markup" && args.client_id) {
				const mkResult = await handleGetBlockMarkup(toolCall, args, ctx);
				console.log(`[ToolExecutor] get-block-markup result:`, { isError: mkResult.isError, client_id: args.client_id });
				toolResults.push(mkResult);
				completedToolsList.push({ ...toolCall, isError: mkResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: mkResult.isError }]);
			}

			// ── blu/highlight-block ──
			else if (toolName === "blu-highlight-block" && args.client_id) {
				const hlResult = await handleHighlightBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] highlight-block result:`, { isError: hlResult.isError, client_id: args.client_id });
				toolResults.push(hlResult);
				completedToolsList.push({ ...toolCall, isError: hlResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: hlResult.isError }]);
			}

			// ── blu/update-block-attrs ──
			else if (toolName === "blu-update-block-attrs" && args.client_id && args.attributes) {
				const attrResult = await handleUpdateBlockAttrs(toolCall, args, ctx);
				console.log(`[ToolExecutor] update-block-attrs result:`, { isError: attrResult.isError, hasChanges: attrResult.hasChanges, client_id: args.client_id });
				if (!attrResult.isError && attrResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(attrResult);
				completedToolsList.push({ ...toolCall, isError: attrResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: attrResult.isError }]);
			}

			// ── blu/replace-image ──
			else if (toolName === "blu-replace-image" && args.client_id && args.url) {
				const imgResult = await handleReplaceImage(toolCall, args, ctx);
				console.log(`[ToolExecutor] replace-image result:`, { isError: imgResult.isError, hasChanges: imgResult.hasChanges });
				if (!imgResult.isError && imgResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(imgResult);
				completedToolsList.push({ ...toolCall, isError: imgResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: imgResult.isError }]);
			}

			// ── blu/update-text ──
			else if (toolName === "blu-update-text" && args.client_id && args.text !== undefined) {
				const utResult = await handleUpdateText(toolCall, args, ctx);
				console.log(`[ToolExecutor] update-text result:`, { isError: utResult.isError, hasChanges: utResult.hasChanges, client_id: args.client_id });
				if (!utResult.isError && utResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(utResult);
				completedToolsList.push({ ...toolCall, isError: utResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: utResult.isError }]);
			}

			// ── blu/duplicate-block ──
			else if (toolName === "blu-duplicate-block" && args.client_id) {
				const dupResult = await handleDuplicateBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] duplicate-block result:`, { isError: dupResult.isError, hasChanges: dupResult.hasChanges });
				if (!dupResult.isError && dupResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(dupResult);
				completedToolsList.push({ ...toolCall, isError: dupResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: dupResult.isError }]);
			}

			// ── blu/batch-update-attrs ──
			else if (toolName === "blu-batch-update-attrs" && args.updates) {
				const batchResult = await handleBatchUpdateAttrs(toolCall, args, ctx);
				console.log(`[ToolExecutor] batch-update-attrs result:`, { isError: batchResult.isError, hasChanges: batchResult.hasChanges, count: args.updates?.length });
				if (!batchResult.isError && batchResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(batchResult);
				completedToolsList.push({ ...toolCall, isError: batchResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: batchResult.isError }]);
			}

			// ── blu/insert-block ──
			else if (toolName === "blu-insert-block" && args.block_name) {
				const ibResult = await handleInsertBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] insert-block result:`, { isError: ibResult.isError, hasChanges: ibResult.hasChanges, block_name: args.block_name });
				if (!ibResult.isError && ibResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(ibResult);
				completedToolsList.push({ ...toolCall, isError: ibResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: ibResult.isError }]);
			}

			// ── blu/rewrite-text ──
			else if (toolName === "blu-rewrite-text" && args.client_id && args.instructions) {
				const rwResult = await handleRewriteText(toolCall, args, ctx);
				console.log(`[ToolExecutor] rewrite-text result:`, { isError: rwResult.isError, hasChanges: rwResult.hasChanges });
				if (!rwResult.isError && rwResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(rwResult);
				completedToolsList.push({ ...toolCall, isError: rwResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: rwResult.isError }]);
			}

			// ── blu/search-patterns ──
			else if (toolName === "blu-search-patterns" && args.query) {
				const spResult = await handleSearchPatterns(toolCall, args, ctx);
				console.log(`[ToolExecutor] search-patterns result:`, { query: args.query, found: !!spResult });
				if (spResult) {
					toolResults.push(spResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				} else {
					toolResults.push({ id: toolCall.id, result: null, isError: false });
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				}
			}

			// ── blu/get-pattern-markup ──
			else if (toolName === "blu-get-pattern-markup" && args.slug) {
				const pmResult = await handleGetPatternMarkup(toolCall, args, ctx);
				console.log(`[ToolExecutor] get-pattern-markup result:`, { slug: args.slug, found: !!pmResult });
				if (pmResult) {
					toolResults.push(pmResult);
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				} else {
					toolResults.push({ id: toolCall.id, result: null, isError: false });
					completedToolsList.push({ ...toolCall, isError: false });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
				}
			}

			// ── Default: skip unrecognized tools ──
			// The gateway executes all tools server-side via MCP.
			// Only editor-specific tools (block editing, styles) need client-side execution.
			else {
				console.warn(`[ToolExecutor] Unrecognized client tool, skipping: ${toolName}`, args);
				toolResults.push({ id: toolCall.id, result: null, isError: false });
				completedToolsList.push({ ...toolCall, isError: false });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
			}

			// Tool results are sent back after the loop completes (see below).
		} catch (err) {
			console.error(`[ToolExecutor] Error executing ${toolCall.name}:`, err);
			await ctx.updateProgress(
				__("Action failed:", "wp-module-editor-chat") + " " + err.message,
				1000
			);
			toolResults.push({ id: toolCall.id, result: null, error: err.message });
			completedToolsList.push({ ...toolCall, isError: true, errorMessage: err.message });
			ctx.setExecutedTools((prev) => [
				...prev,
				{ ...toolCall, isError: true, errorMessage: err.message },
			]);

		}
	}

	const hasChanges = toolResults.some((r) => r.hasChanges);

	// Send actual tool results back to the backend so the LLM knows what
	// really happened (success/failure) instead of relying on stubs.
	if (ctx.sendToolResult) {
		// Tools that return data the model needs (read-only tools).
		const READ_TOOLS = new Set(["blu-get-block-markup", "blu-get-global-styles", "blu-search-patterns", "blu-get-pattern-markup", "blu-highlight-block"]);

		const resultPayload = toolResults
			.filter((r) => r.id)
			.map((r) => {
				const toolName_ = toolCalls.find((tc) => tc.id === r.id)?.name || "unknown";
				// For read-only tools, send actual result data back so the model can act on it
				let summary;
				if (r.isError) {
					summary = r.error || r.result?.[0]?.text || "Tool failed";
				} else if (READ_TOOLS.has(toolName_) && r.result?.[0]?.text) {
					summary = r.result[0].text;
				} else {
					summary = r.hasChanges ? "Applied successfully" : "No changes needed";
				}
				return {
					tool_call_id: r.id,
					tool_name: toolName_,
					success: !r.isError,
					summary,
				};
			});
		if (resultPayload.length > 0) {
			ctx.sendToolResult(JSON.stringify(resultPayload));
		}
	}

	// Build composite undo data from both block snapshot and global styles
	let compositeUndoData = null;
	if (hasChanges) {
		const undoParts = {};
		if (hasBlockEdits && ctx.blockSnapshotRef.current) {
			undoParts.blocks = ctx.blockSnapshotRef.current;
		}
		if (globalStylesUndoData) {
			undoParts.globalStyles = globalStylesUndoData;
		}
		if (Object.keys(undoParts).length > 0) {
			compositeUndoData = undoParts;
		}
	}

	// Insert a dedicated tool_execution message right after the reasoning
	// message so it appears between reasoning and the result.  The backend
	// streams result chunks while client-side tools are still running, so
	// result messages may already be in the array — splicing after the
	// reasoning landmark keeps the correct visual order.
	if (compositeUndoData || completedToolsList.length > 0) {
		const toolExecMsg = {
			id: `tool-exec-${Date.now()}`,
			role: "assistant",
			type: "tool_execution",
			executedTools: [...completedToolsList],
			...(compositeUndoData ? { hasActions: true, undoData: compositeUndoData } : {}),
			timestamp: new Date(),
		};

		ctx.setMessages((prev) => {
			// Find the reasoning message flushed by the tool_call handler
			// (messageHandler adds the "-reasoning" suffix to its ID).
			let insertIdx = -1;
			for (let i = prev.length - 1; i >= 0; i--) {
				if (prev[i].id?.endsWith("-reasoning")) {
					insertIdx = i + 1;
					break;
				}
			}
			// Fallback: insert after the last user message
			if (insertIdx === -1) {
				for (let i = prev.length - 1; i >= 0; i--) {
					if (prev[i].role === "user") {
						insertIdx = i + 1;
						break;
					}
				}
			}
			// Last resort: append at end
			if (insertIdx === -1) {
				return [...prev, toolExecMsg];
			}
			return [...prev.slice(0, insertIdx), toolExecMsg, ...prev.slice(insertIdx)];
		});
	}

	// Persist ref for SUMMARIZING status, then clear state to remove TypingIndicator duplicate
	if (completedToolsList.length > 0) {
		ctx.executedToolsRef.current = [...completedToolsList];
		ctx.setExecutedTools([]);
	}

	// Clear tool execution UI state
	ctx.setActiveToolCall(null);
	ctx.setToolProgress(null);
	ctx.setPendingTools([]);
	// Don't set isLoading = false or status = null — WebSocket hook manages those
}
