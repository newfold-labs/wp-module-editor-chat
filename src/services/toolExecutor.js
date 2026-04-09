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
import { safeParseJSON } from "../utils/jsonUtils";
import { snapshotBlocks } from "../utils/editorContext";

/**
 * Module-level tracker for the last successful pattern search results.
 * Used by code-level enforcement: when the AI calls blu-edit-block or
 * blu-add-section with its own block_content instead of pattern_slug,
 * we auto-substitute the top search result's slug so the pattern library
 * markup is used (with text customization) instead of broken AI-generated HTML.
 */
let lastPatternSearchResults = null;

/**
 * Module-level tracker for image URLs generated during this user turn.
 * Populated by blu-generate-image results, consumed by handleAddSection
 * and handleEditBlock for deduplication.
 */
let generatedImageUrls = [];

/**
 * Clear the cached pattern search results and generated image tracker.
 * Called at the start of each new user turn so stale results from a
 * previous request (e.g. testimonial search) don't contaminate the
 * next request (e.g. header edit).
 */
export function resetPatternSearchCache() {
	lastPatternSearchResults = null;
	generatedImageUrls = [];
}

/**
 * Extract all image URLs from block markup (src attributes of img tags).
 *
 * @param {string} markup Block markup
 * @return {string[]} Array of image URLs found in the markup
 */
function extractImageUrls(markup) {
	const urls = [];
	const re = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
	let m;
	while ((m = re.exec(markup)) !== null) {
		urls.push(m[1]);
	}
	return urls;
}

/**
 * Replace duplicate image URLs in block markup with unused generated images.
 *
 * Scans `markup` for <img> src values that appear more than once.  For each
 * duplicate occurrence (after the first), substitutes an unused URL from
 * `availableUrls`.  Returns the patched markup and a list of replacements
 * made (for logging).
 *
 * @param {string}   markup        Block markup HTML string
 * @param {string[]} availableUrls Pool of generated image URLs to draw from
 * @return {{ markup: string, replacements: Array<{from: string, to: string}> }}
 */
function deduplicateImages(markup, availableUrls) {
	const imgUrls = extractImageUrls(markup);
	if (imgUrls.length === 0) return { markup, replacements: [] };

	// Find URLs that appear more than once
	const seen = new Map(); // url → count
	for (const url of imgUrls) {
		seen.set(url, (seen.get(url) || 0) + 1);
	}

	const duplicateUrls = [...seen.entries()]
		.filter(([, count]) => count > 1)
		.map(([url]) => url);

	if (duplicateUrls.length === 0) return { markup, replacements: [] };

	// Build pool of unused URLs (generated but not referenced in markup)
	const usedInMarkup = new Set(imgUrls);
	const unusedPool = availableUrls.filter((u) => !usedInMarkup.has(u));

	const replacements = [];
	let result = markup;

	for (const dupUrl of duplicateUrls) {
		// Find all occurrences — keep the first, replace subsequent
		const escaped = dupUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const srcRe = new RegExp(`(src=["'])${escaped}(["'])`, "g");
		let matchIdx = 0;
		result = result.replace(srcRe, (full, pre, post) => {
			matchIdx++;
			if (matchIdx === 1) return full; // keep first occurrence
			if (unusedPool.length > 0) {
				const replacement = unusedPool.shift();
				replacements.push({ from: dupUrl, to: replacement });
				return `${pre}${replacement}${post}`;
			}
			return full; // no unused images available
		});
	}

	return { markup: result, replacements };
}

/**
 * Create or replace the single tool_execution message for the current turn.
 * Caller passes the COMPLETE list of tools; any existing message is replaced
 * (not appended) so duplicates are impossible across multi-round calls.
 *
 * @param {Function} setMessages React state setter for messages
 * @param {Array}    tools       Complete list of tool objects for this turn
 * @param {Object}   [undoData]  Optional undo data for accept/decline
 */
export function upsertToolExecMsg(setMessages, tools, undoData) {
	if (!tools || tools.length === 0) {
		return;
	}

	setMessages((prev) => {
		// Scope: only merge with a tool_execution after the last user message
		let lastUserIdx = -1;
		for (let i = prev.length - 1; i >= 0; i--) {
			if (prev[i].role === "user") {
				lastUserIdx = i;
				break;
			}
		}

		// Find existing tool_execution message in the current turn
		let existingIdx = -1;
		for (let i = prev.length - 1; i > lastUserIdx; i--) {
			if (prev[i].type === "tool_execution") {
				existingIdx = i;
				break;
			}
		}

		if (existingIdx !== -1) {
			const existing = prev[existingIdx];
			const updated = {
				...existing,
				executedTools: [...tools],
				...(undoData ? { hasActions: true, undoData } : {}),
			};
			return [
				...prev.slice(0, existingIdx),
				updated,
				...prev.slice(existingIdx + 1),
			];
		}

		// Create new — insert after reasoning or after last user message
		const toolExecMsg = {
			id: `tool-exec-${Date.now()}`,
			role: "assistant",
			type: "tool_execution",
			executedTools: [...tools],
			...(undoData ? { hasActions: true, undoData } : {}),
			timestamp: new Date(),
		};

		let insertIdx = -1;
		for (let i = prev.length - 1; i > lastUserIdx; i--) {
			if (prev[i].id?.endsWith("-reasoning")) {
				insertIdx = i + 1;
				break;
			}
		}
		if (insertIdx === -1) {
			insertIdx = Math.max(lastUserIdx + 1, 0);
		}
		return [
			...prev.slice(0, insertIdx),
			toolExecMsg,
			...prev.slice(insertIdx),
		];
	});
}

/** Block-mutating tool names that require a snapshot for undo. */
const BLOCK_TOOL_NAMES = [
	"blu-edit-block",
	"blu-add-section",
	"blu-delete-block",
	"blu-move-block",
	"blu-rewrite-text",
	"blu-update-block-attrs",
];

/**
 * Replace image URLs in pattern markup with provided URLs (e.g. from search_images).
 *
 * Collects all unique image URLs from the pattern (block comment attrs, img src,
 * background-image) and replaces them in order with the provided URLs.
 * Works for core/image, core/cover, and any block with image URLs.
 * @param {string} markup
 * @param {Array}  imageUrls
 */
function replacePatternImages(markup, imageUrls) {
	if (!imageUrls || imageUrls.length === 0) {
		return markup;
	}

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
				if (b.innerBlocks?.length) {
					walk(b.innerBlocks);
				}
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
	} catch {
		/* non-critical */
	}

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

	// Fallback to MCP
	const result = await ctx.mcpClient.callTool(toolCall.name, toolCall.arguments);
	return {
		id: toolCall.id,
		result: result.content,
		isError: result.isError,
	};
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

// deepMerge for block attributes — null values remove the key.
// Shared implementation lives in utils/deepMerge.js
import { deepMergeAttrs as deepMerge } from "../utils/deepMerge";

async function handleUpdateBlockAttrs(toolCall, args, ctx) {
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const block = blockEditor.getBlock(args.client_id);

	if (!block) {
		return {
			id: toolCall.id,
			result: [
				{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) },
			],
			isError: true,
		};
	}

	try {
		// ── Generate image from prompt if provided ──
		// Allows "change this image" without exposing blu-generate-image as a tool.
		if (args.image_prompt && !args.attributes?.url) {
			const imgArgs = typeof args.image_prompt === "string"
				? { prompt: args.image_prompt }
				: { prompt: args.image_prompt.prompt, ...args.image_prompt };
			try {
				await ctx.updateProgress(__("Generating image…", "wp-module-editor-chat"), 500);
				const mcpResult = await ctx.mcpClient.callTool("blu-generate-image", imgArgs);
				if (!mcpResult.isError && mcpResult.content?.[0]?.text) {
					const parsed = JSON.parse(mcpResult.content[0].text);
					const url = parsed?.message?.url || parsed?.url;
					if (url) {
						if (!args.attributes) args.attributes = {};
						args.attributes.url = url;
						generatedImageUrls.push(url);
						console.log("[ToolExecutor] update-block-attrs: generated image from prompt:", url);
					}
				}
			} catch (err) {
				console.warn("[ToolExecutor] update-block-attrs: image generation failed:", err.message);
			}
		}

		// ── Normalize common attribute name mistakes ──
		// The AI often sends "textAlign" but WordPress blocks use "align" for
		// text alignment on paragraphs, headings, etc.
		const TEXT_ALIGN_BLOCKS = new Set([
			"core/paragraph", "core/heading", "core/verse", "core/preformatted",
			"core/list", "core/quote", "core/pullquote",
		]);
		if ("textAlign" in args.attributes && !("align" in args.attributes) && TEXT_ALIGN_BLOCKS.has(block.name)) {
			args.attributes.align = args.attributes.textAlign;
			delete args.attributes.textAlign;
			console.log(`[ToolExecutor] update-block-attrs: normalized textAlign → align for ${block.name}`);
		}

		// Auto-clear media library ID when replacing image URL on image blocks
		const IMAGE_BLOCKS = ["core/image", "core/cover", "core/media-text"];
		if (args.attributes.url && IMAGE_BLOCKS.includes(block.name) && !("id" in args.attributes)) {
			args.attributes.id = 0;
		}

		// Detect no-op for content changes (text already matches)
		if ("content" in args.attributes) {
			const stripTags = (html) => (html || "").replace(/<[^>]+>/g, "").trim();
			const oldPlain = stripTags(block.attributes.content || "");
			const newPlain = stripTags(args.attributes.content || "");
			if (oldPlain === newPlain) {
				return {
					id: toolCall.id,
					result: [{ type: "text", text: JSON.stringify({
						success: true,
						message: `Text is already "${oldPlain.substring(0, 60)}" — no change needed`,
					}) }],
					isError: false,
					hasChanges: false,
				};
			}
		}

		// Auto-clear conflicting preset/custom color attributes.
		// WordPress treats preset slugs (textColor, backgroundColor) and custom
		// styles (style.color.text, style.color.background) as mutually exclusive.
		// If both are present, the preset wins and the custom value is ignored.
		// This mirrors what the WordPress color picker UI does.
		const customText = args.attributes?.style?.color?.text;
		const customBg = args.attributes?.style?.color?.background;
		if (customText && block.attributes.textColor && !("textColor" in args.attributes)) {
			args.attributes.textColor = null;
		}
		if (customBg && block.attributes.backgroundColor && !("backgroundColor" in args.attributes)) {
			args.attributes.backgroundColor = null;
		}
		// Also handle the reverse: if setting a preset, clear the custom style
		if (args.attributes.textColor && block.attributes?.style?.color?.text) {
			if (!args.attributes.style) args.attributes.style = {};
			if (!args.attributes.style.color) args.attributes.style.color = {};
			args.attributes.style.color.text = null;
		}
		if (args.attributes.backgroundColor && block.attributes?.style?.color?.background) {
			if (!args.attributes.style) args.attributes.style = {};
			if (!args.attributes.style.color) args.attributes.style.color = {};
			args.attributes.style.color.background = null;
		}

		// Deep-merge new attributes into existing ones (null removes keys)
		const merged = deepMerge(block.attributes, args.attributes);
		wpDispatch("core/block-editor").updateBlockAttributes(args.client_id, merged);

		// Build descriptive result message
		let message = "Attributes updated";
		if ("content" in args.attributes) {
			const stripTags = (html) => (html || "").replace(/<[^>]+>/g, "").trim();
			const newPlain = stripTags(args.attributes.content || "");
			message = `Text set to "${newPlain.substring(0, 60)}"`;
		} else if ("url" in args.attributes) {
			message = "Image URL updated";
		}

		return {
			id: toolCall.id,
			result: [
				{ type: "text", text: JSON.stringify({ success: true, message }) },
			],
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
			result: [
				{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) },
			],
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
				result: [
					{
						type: "text",
						text: JSON.stringify({ success: true, message: "No text changes needed" }),
					},
				],
				isError: false,
			};
		}

		// Apply the rewritten markup back to the block
		const editResult = await handleRewriteAction(clientId, rewritten);

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(editResult) }],
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
				await ctx.updateProgress(
					__("Customizing content for your site…", "wp-module-editor-chat"),
					500
				);
				try {
					const lastUserMsg =
						ctx
							.getMessages?.()
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
					{ type: "text", text: JSON.stringify({ success: false, error: fetchErr.message }) },
				],
				isError: true,
			};
		}
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	// ── Auto-deduplicate images ──
	if (generatedImageUrls.length > 0) {
		const dedup = deduplicateImages(args.block_content, generatedImageUrls);
		if (dedup.replacements.length > 0) {
			console.log(
				`[ToolExecutor] edit-block: auto-replaced ${dedup.replacements.length} duplicate image(s)`,
				dedup.replacements
			);
			args.block_content = dedup.markup;
		}
	}

	// ── Guard: reject extremely large rewrites on very complex blocks ──
	// For moderate structural edits (e.g. splitting columns into rows),
	// we let the edit through — the validation + safe merge path below
	// catches broken markup and lost inner blocks. Only block truly
	// massive rewrites that are almost certainly truncated AI output.
	{
		const { select: wpSel } = wp.data;
		const targetBlock = wpSel("core/block-editor").getBlock(args.client_id);
		if (targetBlock) {
			const innerCount = countInnerBlocks(targetBlock);
			if (innerCount >= 40 && args.block_content.length > 12000) {
				console.warn(
					`[ToolExecutor] Rejecting very large edit-block rewrite: ${args.block_content.length} chars targeting block with ${innerCount} inner blocks`
				);
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `This block has ${innerCount} inner blocks — rewriting ${args.block_content.length} chars of markup at once risks broken output. Use a smaller tool instead: (1) For style/spacing/color changes, use blu-update-block-attrs on this block or its children — no markup needed. (2) For text changes, use blu-rewrite-text with an "instructions" string. (3) For adding new content, use blu-add-section with before/after_client_id. (4) For structural reorganization, use blu-move-block and blu-delete-block.`,
							}),
						},
					],
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

	const finalContent = validation.correctedContent || args.block_content;

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

	// Debug: log original vs replacement content to diagnose no-op edits
	{
		const { serialize } = wp.blocks;
		const origBlock = wpSelect("core/block-editor").getBlock(args.client_id);
		const origContent = origBlock ? serialize(origBlock) : "(not found)";
		// eslint-disable-next-line no-console
		console.log("[ToolExecutor] edit-block applying to:", args.client_id, origBlock?.name);
		// eslint-disable-next-line no-console
		console.log("[ToolExecutor] edit-block ORIGINAL attrs:", JSON.stringify(origBlock?.attributes));
		// eslint-disable-next-line no-console
		console.log("[ToolExecutor] edit-block REPLACEMENT content (first 500):", finalContent.substring(0, 500));
		if (origContent === finalContent) {
			// eslint-disable-next-line no-console
			console.warn("[ToolExecutor] edit-block: REPLACEMENT IS IDENTICAL TO ORIGINAL — no-op edit");
		}
	}

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
				await ctx.updateProgress(
					__("Customizing content for your site…", "wp-module-editor-chat"),
					500
				);
				try {
					const lastUserMsg =
						ctx
							.getMessages?.()
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

	// ── Image placeholder resolution ──
	// Count __IMG_N__ placeholders in the markup
	const imgPlaceholders = args.block_content.match(/__IMG_\d+__/g) || [];
	const uniquePlaceholders = [...new Set(imgPlaceholders)];

	if (uniquePlaceholders.length > 0) {
		// Preferred path: generate images from image_prompts (markup-first flow)
		if (args.image_prompts && Array.isArray(args.image_prompts) && args.image_prompts.length > 0) {
			const promptCount = Math.min(args.image_prompts.length, uniquePlaceholders.length);
			console.log(`[ToolExecutor] add-section: generating ${promptCount} images from image_prompts`);

			const imageUrls = [];
			for (let i = 0; i < promptCount; i++) {
				const prompt = args.image_prompts[i];
				const imgArgs = typeof prompt === "string"
					? { prompt }
					: { prompt: prompt.prompt, ...prompt };

				await ctx.updateProgress(
					__("Generating image…", "wp-module-editor-chat") + ` (${i + 1}/${promptCount})`,
					500
				);
				try {
					const mcpResult = await ctx.mcpClient.callTool("blu-generate-image", imgArgs);
					if (!mcpResult.isError && mcpResult.content?.[0]?.text) {
						const parsed = JSON.parse(mcpResult.content[0].text);
						const url = parsed?.message?.url || parsed?.url;
						if (url) {
							imageUrls.push(url);
							generatedImageUrls.push(url);
						}
					}
				} catch (err) {
					console.warn(`[ToolExecutor] add-section: image generation ${i + 1} failed:`, err.message);
				}
			}

			// Substitute placeholders with generated URLs
			for (let i = 0; i < imageUrls.length; i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, imageUrls[i]);
			}

			console.log(`[ToolExecutor] add-section: resolved ${imageUrls.length}/${uniquePlaceholders.length} image placeholders`);
		}
		// Fallback: substitute from pre-supplied image_urls array
		else if (args.image_urls && Array.isArray(args.image_urls) && args.image_urls.length > 0) {
			for (let i = 0; i < args.image_urls.length; i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, args.image_urls[i]);
			}
		}
		// Fallback: substitute from previously generated images in this turn
		else if (generatedImageUrls.length > 0) {
			for (let i = 0; i < Math.min(generatedImageUrls.length, uniquePlaceholders.length); i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, generatedImageUrls[i]);
			}
		}

		// Warn about unresolved placeholders
		const unresolved = (args.block_content.match(/__IMG_\d+__/g) || []);
		if (unresolved.length > 0) {
			console.warn(`[ToolExecutor] add-section: ${unresolved.length} image placeholders unresolved:`, unresolved);
		}
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	// ── Auto-deduplicate images ──
	// If the AI used the same image URL more than once, replace duplicates
	// with unused generated images from this conversation turn.
	if (generatedImageUrls.length > 0) {
		const dedup = deduplicateImages(args.block_content, generatedImageUrls);
		if (dedup.replacements.length > 0) {
			console.log(
				`[ToolExecutor] add-section: auto-replaced ${dedup.replacements.length} duplicate image(s)`,
				dedup.replacements
			);
			args.block_content = dedup.markup;
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
		const moveResult = await handleMoveAction(
			args.client_id,
			args.target_client_id || null,
			args.position || null,
			args.as_child_of || null
		);
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
	// Fallback to MCP
	const result = await ctx.mcpClient.callTool(toolCall.name, toolCall.arguments);
	return {
		id: toolCall.id,
		result: result.content,
		isError: result.isError,
	};
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
	console.log(
		"[ToolExecutor] Received tool calls:",
		toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments }))
	);

	// Internal/silent tools that should never appear in the tool execution list.
	// These are backend discovery calls, not user-facing actions.
	const SILENT_TOOLS = new Set([
		"get_available_wordpress_actions",
		"WordPressPlugin-get_available_wordpress_actions",
		"get_wordpress_sites",
		"WordPressPlugin-get_wordpress_sites",
	]);

	// Separate server-side (already executed by backend) and client-side tools
	const serverToolCalls = [];
	const clientToolCalls = [];
	for (const tc of toolCalls) {
		const name = tc.name || "";
		// Skip silent/internal tools entirely — don't show or track them
		if (SILENT_TOOLS.has(name)) {
			console.log(`[ToolExecutor] Silent tool (hidden from UI): ${name}`);
			continue;
		}
		if (name.startsWith("blu-")) {
			clientToolCalls.push(tc);
		} else {
			console.log(`[ToolExecutor] Server-side tool (already executed): ${name}`);
			serverToolCalls.push(tc);
		}
	}

	const serverCompleted = serverToolCalls.map((tc, idx) => ({
		id: tc.id || `server-tool-${Date.now()}-${idx}`,
		name: tc.name,
		arguments: tc.arguments,
		isError: false,
	}));

	// Track server-side tools in state for TypingIndicator display.
	// The persistent tool_execution message is created only AFTER execution
	// finishes (or via useEffect for server-only rounds) so there's a single
	// unified tool list — never two separate windows.
	if (serverCompleted.length > 0) {
		ctx.setExecutedTools((prev) => [...prev, ...serverCompleted]);
	}

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

		// Yield to let React render the active tool state before executing
		await new Promise((r) => requestAnimationFrame(r));

		try {
			let toolName = toolCall.name || "";
			console.log(
				`[ToolExecutor] Executing ${toolIndex}/${totalTools}: ${toolName}`,
				toolCall.arguments
			);
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
						if (esc) {
							esc = false;
							continue;
						}
						if (ch === "\\" && inStr) {
							esc = true;
							continue;
						}
						if (ch === '"') {
							inStr = !inStr;
							continue;
						}
						if (inStr) {
							continue;
						}
						if (ch === "{") {
							depth++;
						}
						if (ch === "}") {
							depth--;
							if (depth === 0) {
								try {
									args = JSON.parse(args.substring(0, ci + 1));
									recovered = true;
								} catch {
									/* ignore */
								}
								break;
							}
						}
					}
					if (!recovered) {
						args = {};
					}
				}
			}

			// ── Normalize common alt param names ──
			// The AI sometimes uses camelCase or alternate names.
			if (!args.client_id && args.clientId) {
				args.client_id = args.clientId;
			}
			if (
				(toolName === "blu-edit-block" || toolName === "blu-add-section") &&
				!args.block_content
			) {
				const alt = args.content || args.markup || args.html || args.block_markup;
				if (alt) {
					args.block_content = alt;
				}
			}

			// ── Pattern enforcement: prefer library patterns over AI-generated markup ──
			if (
				(toolName === "blu-edit-block" || toolName === "blu-add-section") &&
				args.block_content &&
				!args.pattern_slug &&
				lastPatternSearchResults &&
				Date.now() - lastPatternSearchResults.timestamp < 120000 &&
				lastPatternSearchResults.results.length > 0
			) {
				const topPattern = lastPatternSearchResults.results[0];
				console.log(
					`[ToolExecutor] Auto-correcting: using pattern_slug "${topPattern.slug}" instead of AI-generated block_content`
				);
				args.pattern_slug = topPattern.slug;
				delete args.block_content;
				lastPatternSearchResults = null;
			}

			// edit-block without client_id → treat as add-section
			if (
				toolName === "blu-edit-block" &&
				!args.client_id &&
				(args.block_content || args.pattern_slug)
			) {
				console.log(`[ToolExecutor] Redirecting blu-edit-block → blu-add-section (no client_id)`);
				toolName = "blu-add-section";
			}

			// ── blu/update-global-styles ──
			if (toolName === "blu-update-global-styles" && args.settings) {
				console.log(
					`[ToolExecutor] update-global-styles args.settings:`,
					JSON.stringify(args.settings)
				);
				const gsResult = await handleUpdateGlobalStyles(toolCall, args, ctx);
				const isError = gsResult.toolResult.isError;
				console.log(`[ToolExecutor] update-global-styles result:`, {
					isError,
					result: gsResult.toolResult.result,
				});
				toolResults.push(gsResult.toolResult);
				completedToolsList.push({ ...toolCall, isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError }]);
				if (gsResult.globalStylesUndoData) {
					globalStylesUndoData = gsResult.globalStylesUndoData;
				}
			}

			// ── blu/get-global-styles ──
			else if (toolName === "blu-get-global-styles" || toolName === "blu-get-active-global-styles") {
				const gsResult = await handleGetGlobalStyles(toolCall, ctx);
				const isError = gsResult.isError ?? false;
				console.log(`[ToolExecutor] get-global-styles result:`, { isError });
				toolResults.push(gsResult);
				completedToolsList.push({ ...toolCall, isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError }]);
			}

			// ── blu/edit-block ──
			else if (
				toolName === "blu-edit-block" &&
				args.client_id &&
				(args.block_content || args.pattern_slug)
			) {
				const editResult = await handleEditBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] edit-block result:`, {
					isError: editResult.isError,
					hasChanges: editResult.hasChanges,
				});
				if (!editResult.isError && editResult.hasChanges) {
					hasBlockEdits = true;
				}
				toolResults.push(editResult);
				completedToolsList.push({ ...toolCall, isError: editResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: editResult.isError }]);
			}

			// ── blu/add-section ──
			else if (toolName === "blu-add-section" && (args.block_content || args.pattern_slug)) {
				console.log(`[ToolExecutor] add-section args:`, {
					pattern_slug: args.pattern_slug,
					has_block_content: !!args.block_content,
					image_urls: args.image_urls,
				});
				const addResult = await handleAddSection(toolCall, args, ctx);
				console.log(`[ToolExecutor] add-section result:`, {
					isError: addResult.isError,
					hasChanges: addResult.hasChanges,
				});
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
				console.log(`[ToolExecutor] delete-block result:`, {
					isError: delResult.isError,
					hasChanges: delResult.hasChanges,
					client_id: args.client_id,
				});
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
				((args.target_client_id && args.position) || args.as_child_of)
			) {
				const mvResult = await handleMoveBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] move-block result:`, {
					isError: mvResult.isError,
					hasChanges: mvResult.hasChanges,
				});
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
				console.log(`[ToolExecutor] get-block-markup result:`, {
					isError: mkResult.isError,
					client_id: args.client_id,
				});
				toolResults.push(mkResult);
				completedToolsList.push({ ...toolCall, isError: mkResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: mkResult.isError }]);
			}

			// ── blu/highlight-block ──
			else if (toolName === "blu-highlight-block" && args.client_id) {
				const hlResult = await handleHighlightBlock(toolCall, args, ctx);
				console.log(`[ToolExecutor] highlight-block result:`, {
					isError: hlResult.isError,
					client_id: args.client_id,
				});
				toolResults.push(hlResult);
				completedToolsList.push({ ...toolCall, isError: hlResult.isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: hlResult.isError }]);
			}

			// ── blu/update-block-attrs ──
			else if (toolName === "blu-update-block-attrs" && args.client_id) {
				// Auto-wrap: if the model sent properties at the top level instead of
				// nesting them under `attributes`, wrap them so the handler can proceed.
				// Preserve handler-level params (image_prompt) that aren't block attributes.
				if (!args.attributes) {
					const { client_id, image_prompt, ...rest } = args;
					if (Object.keys(rest).length > 0) {
						console.warn(`[ToolExecutor] Auto-wrapping loose properties into attributes for blu-update-block-attrs`, rest);
						args = { client_id, attributes: rest };
					} else {
						args = { client_id, attributes: {} };
					}
					if (image_prompt) args.image_prompt = image_prompt;
				}

				if (args.attributes || args.image_prompt) {
					const attrResult = await handleUpdateBlockAttrs(toolCall, args, ctx);
					console.log(`[ToolExecutor] update-block-attrs result:`, {
						isError: attrResult.isError,
						hasChanges: attrResult.hasChanges,
						client_id: args.client_id,
					});
					if (!attrResult.isError && attrResult.hasChanges) {
						hasBlockEdits = true;
					}
					toolResults.push(attrResult);
					completedToolsList.push({ ...toolCall, isError: attrResult.isError });
					ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError: attrResult.isError }]);
				}
			}

			// ── blu/rewrite-text ──
			else if (toolName === "blu-rewrite-text" && args.client_id && args.instructions) {
				const rwResult = await handleRewriteText(toolCall, args, ctx);
				console.log(`[ToolExecutor] rewrite-text result:`, {
					isError: rwResult.isError,
					hasChanges: rwResult.hasChanges,
				});
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
				const isError = spResult.isError ?? false;
				console.log(`[ToolExecutor] search-patterns result:`, { query: args.query, isError });
				toolResults.push(spResult);
				completedToolsList.push({ ...toolCall, isError });
				ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError }]);
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
		const READ_TOOLS = new Set([
			"blu-get-block-markup",
			"blu-get-global-styles",
			"blu-search-patterns",
			"blu-highlight-block",
			"blu-generate-image",
		]);

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

	// Gather ALL completed tools across rounds: previous rounds (from ref) +
	// current round's server + client tools.  Deduplicate by id so the
	// persistent message always has the complete, correct list.
	const refTools = ctx.executedToolsRef.current || [];
	const seenIds = new Set();
	const allCompletedTools = [];
	for (const t of [...refTools, ...serverCompleted, ...completedToolsList]) {
		if (!seenIds.has(t.id)) {
			seenIds.add(t.id);
			allCompletedTools.push(t);
		}
	}

	// Create / replace the single persistent tool_execution message.
	if (compositeUndoData || allCompletedTools.length > 0) {
		upsertToolExecMsg(ctx.setMessages, allCompletedTools, compositeUndoData);
	}

	// Persist ref for SUMMARIZING status, then clear state so the
	// TypingIndicator disappears (the message is the permanent record).
	if (allCompletedTools.length > 0) {
		ctx.executedToolsRef.current = [...allCompletedTools];
		ctx.setExecutedTools([]);
	}

	// Clear tool execution UI state
	ctx.setActiveToolCall(null);
	ctx.setToolProgress(null);
	ctx.setPendingTools([]);
	// Don't set isLoading = false or status = null — WebSocket hook manages those
}

// ─────────────────────────────────────────────────────────────
// REST-based tool execution (for CF AI Gateway / OpenAI function calling)
// ─────────────────────────────────────────────────────────────

/**
 * Tools that return data the model needs (read-only tools).
 * For these, we send the actual result content back to the AI.
 * For write tools, we just send "Applied successfully" / error.
 */
const READ_TOOLS = new Set([
	"blu-get-block-markup",
	"blu-get-global-styles",
	"blu-search-patterns",
	"blu-highlight-block",
	"blu-generate-image",
]);

/**
 * Execute tool calls for the REST function-calling loop.
 *
 * Unlike executeToolCallsFromWebSocket, this function:
 * - RETURNS results (for appending to conversation as tool messages)
 * - Executes server-side tools via mcpClient.callTool()
 * - Does NOT call sendToolResult (no WebSocket)
 *
 * @param {Array}  toolCalls Tool calls from the OpenAI streaming response
 * @param {Object} ctx       Shared context object with clients, state setters, refs, helpers
 * @return {Promise<Array>}  Array of { tool_call_id, content, isError } for the conversation
 */
export async function executeToolCallsForREST(toolCalls, ctx) {
	console.log(
		"[ToolExecutor:REST] Received tool calls:",
		toolCalls.map((tc) => ({ name: tc.name, args: tc.arguments }))
	);

	const toolResults = [];
	const completedToolsList = [];
	let globalStylesUndoData = null;
	let hasBlockEdits = false;

	// Separate client-side (blu-*) and server-side tools
	const clientToolCalls = [];
	const serverToolCalls = [];
	for (const tc of toolCalls) {
		const name = tc.name || "";
		if (name.startsWith("blu-")) {
			clientToolCalls.push(tc);
		} else {
			serverToolCalls.push(tc);
		}
	}

	// Execute server-side tools via MCP
	for (const tc of serverToolCalls) {
		const mcpName = (tc.name || "").replace(/-/, "/");
		console.log(`[ToolExecutor:REST] Server-side tool via MCP: ${mcpName}`);
		try {
			const mcpResult = await ctx.mcpClient.callTool(mcpName, tc.arguments || {});
			const content = typeof mcpResult === "string" ? mcpResult : JSON.stringify(mcpResult);
			toolResults.push({
				tool_call_id: tc.id,
				content,
				isError: false,
			});
			completedToolsList.push({ ...tc, isError: false });
			ctx.setExecutedTools((prev) => [...prev, { ...tc, isError: false }]);
		} catch (err) {
			console.error(`[ToolExecutor:REST] MCP tool failed: ${mcpName}`, err);
			toolResults.push({
				tool_call_id: tc.id,
				content: JSON.stringify({ error: err.message }),
				isError: true,
			});
			completedToolsList.push({ ...tc, isError: true, errorMessage: err.message });
			ctx.setExecutedTools((prev) => [...prev, { ...tc, isError: true, errorMessage: err.message }]);
		}
	}

	if (clientToolCalls.length === 0) {
		console.log("[ToolExecutor:REST] No client-side tools to execute");
		return toolResults;
	}

	// Capture block snapshot before any tool execution for atomic undo
	const hasBlockTools = clientToolCalls.some((tc) => BLOCK_TOOL_NAMES.includes(tc.name || ""));
	if (hasBlockTools && !ctx.blockSnapshotRef.current) {
		const { select: wpSelect } = wp.data;
		const allBlocks = wpSelect("core/block-editor").getBlocks();
		ctx.blockSnapshotRef.current = snapshotBlocks(allBlocks);
	}

	await ctx.wait(300);
	ctx.setStatus(CHAT_STATUS.TOOL_CALL);
	ctx.setActiveToolCall({
		id: "preparing",
		name: "preparing",
		index: 0,
		total: clientToolCalls.length,
	});
	ctx.setPendingTools(
		clientToolCalls.map((tc, idx) => ({
			...tc,
			id: tc.id || `tool-${idx}`,
		}))
	);

	// Execute client-side tools sequentially (same logic as WebSocket version)
	for (let i = 0; i < clientToolCalls.length; i++) {
		const toolCall = clientToolCalls[i];
		const toolIndex = i + 1;
		const totalTools = clientToolCalls.length;

		ctx.setPendingTools((prev) => prev.filter((_, idx) => idx !== 0));
		ctx.setActiveToolCall({
			id: toolCall.id || `tool-${i}`,
			name: toolCall.name,
			arguments: toolCall.arguments,
			index: toolIndex,
			total: totalTools,
		});

		await new Promise((r) => requestAnimationFrame(r));

		try {
			let toolName = toolCall.name || "";
			console.log(
				`[ToolExecutor:REST] Executing ${toolIndex}/${totalTools}: ${toolName}`,
				toolCall.arguments
			);
			let args = toolCall.arguments || {};
			if (typeof args === "string") {
				args = safeParseJSON(args).value;
			}

			// Normalize alt param names
			if (!args.client_id && args.clientId) {
				args.client_id = args.clientId;
			}
			if (
				(toolName === "blu-edit-block" || toolName === "blu-add-section") &&
				!args.block_content
			) {
				const alt = args.content || args.markup || args.html || args.block_markup;
				if (alt) args.block_content = alt;
			}

			// Pattern enforcement
			if (
				(toolName === "blu-edit-block" || toolName === "blu-add-section") &&
				args.block_content &&
				!args.pattern_slug &&
				lastPatternSearchResults &&
				Date.now() - lastPatternSearchResults.timestamp < 120000 &&
				lastPatternSearchResults.results.length > 0
			) {
				const topPattern = lastPatternSearchResults.results[0];
				console.log(`[ToolExecutor:REST] Auto-correcting: using pattern_slug "${topPattern.slug}"`);
				args.pattern_slug = topPattern.slug;
				delete args.block_content;
				lastPatternSearchResults = null;
			}

			// edit-block without client_id → treat as add-section
			if (toolName === "blu-edit-block" && !args.client_id && (args.block_content || args.pattern_slug)) {
				console.log(`[ToolExecutor:REST] Redirecting blu-edit-block → blu-add-section (no client_id)`);
				toolName = "blu-add-section";
			}

			let result;

			// Dispatch to existing handlers (same as WebSocket version)
			if (toolName === "blu-update-global-styles" && args.settings) {
				const gsResult = await handleUpdateGlobalStyles(toolCall, args, ctx);
				result = gsResult.toolResult;
				if (gsResult.globalStylesUndoData) globalStylesUndoData = gsResult.globalStylesUndoData;
			} else if (toolName === "blu-get-global-styles" || toolName === "blu-get-active-global-styles") {
				result = await handleGetGlobalStyles(toolCall, ctx);
			} else if (toolName === "blu-edit-block" && args.client_id && (args.block_content || args.pattern_slug)) {
				result = await handleEditBlock(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) hasBlockEdits = true;
			} else if (toolName === "blu-add-section" && (args.block_content || args.pattern_slug)) {
				result = await handleAddSection(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) hasBlockEdits = true;
			} else if (toolName === "blu-delete-block" && args.client_id) {
				result = await handleDeleteBlock(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) hasBlockEdits = true;
			} else if (toolName === "blu-move-block" && args.client_id && ((args.target_client_id && args.position) || args.as_child_of)) {
				result = await handleMoveBlock(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) hasBlockEdits = true;
			} else if (toolName === "blu-get-block-markup" && args.client_id) {
				result = await handleGetBlockMarkup(toolCall, args, ctx);
			} else if (toolName === "blu-highlight-block" && args.client_id) {
				result = await handleHighlightBlock(toolCall, args, ctx);
			} else if (toolName === "blu-update-block-attrs" && args.client_id) {
				if (!args.attributes) {
					// Preserve handler-level params that aren't block attributes
					const { client_id, image_prompt, ...rest } = args;
					if (Object.keys(rest).length > 0) {
						console.warn(`[ToolExecutor:REST] Auto-wrapping loose properties into attributes`, rest);
						args = { client_id, attributes: rest };
					} else {
						args = { client_id, attributes: {} };
					}
					if (image_prompt) args.image_prompt = image_prompt;
				}
				if (args.attributes || args.image_prompt) {
					result = await handleUpdateBlockAttrs(toolCall, args, ctx);
					if (!result.isError && result.hasChanges) hasBlockEdits = true;
				}
			} else if (toolName === "blu-rewrite-text" && args.client_id && args.instructions) {
				result = await handleRewriteText(toolCall, args, ctx);
				if (!result.isError && result.hasChanges) hasBlockEdits = true;
			} else if (toolName === "blu-search-patterns" && args.query) {
				result = await handleSearchPatterns(toolCall, args, ctx);
			} else if (toolName === "blu-generate-image" && args.prompt) {
				await ctx.updateProgress(__("Generating image…", "wp-module-editor-chat"), 500);
				try {
					const mcpResult = await ctx.mcpClient.callTool("blu-generate-image", args);
					result = {
						id: toolCall.id,
						result: mcpResult.content,
						isError: mcpResult.isError || false,
					};
					// Track generated image URL for later deduplication
					if (!result.isError && mcpResult.content?.[0]?.text) {
						try {
							const parsed = JSON.parse(mcpResult.content[0].text);
							const url = parsed?.message?.url || parsed?.url;
							if (url) {
								generatedImageUrls.push(url);
								console.log(`[ToolExecutor:REST] Tracked generated image (${generatedImageUrls.length} total):`, url);
							}
						} catch { /* non-critical */ }
					}
				} catch (err) {
					result = {
						id: toolCall.id,
						result: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
						isError: true,
					};
				}
			} else {
				// Server-side MCP tool — forward to MCP server for execution
				console.log(`[ToolExecutor:REST] Forwarding to MCP: ${toolName}`, args);
				try {
					// Only replace first hyphen (namespace separator): blu-add-post → blu/add-post
					const mcpName = toolName.replace(/-/, "/");
					const mcpResult = await ctx.mcpClient.callTool(mcpName, args);
					result = {
						id: toolCall.id,
						result: mcpResult.content,
						isError: mcpResult.isError || false,
					};
				} catch (mcpErr) {
					console.error(`[ToolExecutor:REST] MCP call failed for ${toolName}:`, mcpErr);
					result = {
						id: toolCall.id,
						result: [{ type: "text", text: JSON.stringify({ success: false, error: mcpErr.message }) }],
						isError: true,
					};
				}
			}

			// Build tool result for conversation
			const isError = result?.isError ?? false;
			let content;
			if (isError) {
				content = result.error || result.result?.[0]?.text || "Tool failed";
			} else if (READ_TOOLS.has(toolName) && result?.result?.[0]?.text) {
				content = result.result[0].text;
			} else {
				// Extract human-readable .message from handler's JSON result
				const msg = (() => {
					try { return JSON.parse(result?.result?.[0]?.text)?.message; } catch { return null; }
				})();
				content = result?.hasChanges
					? (msg || "Applied successfully")
					: "No changes needed";
			}

			toolResults.push({ tool_call_id: toolCall.id, content, isError, hasChanges: result?.hasChanges || false });
			completedToolsList.push({ ...toolCall, isError });
			ctx.setExecutedTools((prev) => [...prev, { ...toolCall, isError }]);
		} catch (err) {
			console.error(`[ToolExecutor:REST] Error executing ${toolCall.name}:`, err);
			await ctx.updateProgress(
				__("Action failed:", "wp-module-editor-chat") + " " + err.message,
				1000
			);
			toolResults.push({
				tool_call_id: toolCall.id,
				content: JSON.stringify({ error: err.message }),
				isError: true,
			});
			completedToolsList.push({ ...toolCall, isError: true, errorMessage: err.message });
			ctx.setExecutedTools((prev) => [
				...prev,
				{ ...toolCall, isError: true, errorMessage: err.message },
			]);
		}
	}

	// Build composite undo data
	const hasChanges = toolResults.some((r) => r.hasChanges);
	let compositeUndoData = null;
	if (hasChanges || hasBlockEdits) {
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

	// Persist tool execution as display message
	const refTools = ctx.executedToolsRef.current || [];
	const seenIds = new Set();
	const allCompletedTools = [];
	for (const t of [...refTools, ...completedToolsList]) {
		if (!seenIds.has(t.id)) {
			seenIds.add(t.id);
			allCompletedTools.push(t);
		}
	}

	if (compositeUndoData || allCompletedTools.length > 0) {
		upsertToolExecMsg(ctx.setMessages, allCompletedTools, compositeUndoData);
	}

	if (allCompletedTools.length > 0) {
		ctx.executedToolsRef.current = [...allCompletedTools];
		ctx.setExecutedTools([]);
	}

	// Clear tool execution UI state
	ctx.setActiveToolCall(null);
	ctx.setToolProgress(null);
	ctx.setPendingTools([]);

	return toolResults;
}
