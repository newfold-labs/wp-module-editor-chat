import { __ } from "@wordpress/i18n";

import { validateBlockMarkup } from "../../utils/blockValidator";
import { handleRewriteAction } from "../blockActions";
import { callImageAbility, getBlockImageUrl } from "../imageAbility";
import { appendGeneratedImageUrl, deduplicateImages, getGeneratedImageUrls } from "../imageCache";
import logger from "../../utils/logger";

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

export async function handleEditBlock(toolCall, args, ctx) {
	// ── Image placeholder resolution (mirrors add-section) ──
	const imgPlaceholders = args.block_content.match(/__IMG_\d+__/g) || [];
	const uniquePlaceholders = [...new Set(imgPlaceholders)];

	if (uniquePlaceholders.length > 0) {
		if (args.image_prompts && Array.isArray(args.image_prompts) && args.image_prompts.length > 0) {
			const promptCount = Math.min(args.image_prompts.length, uniquePlaceholders.length);

			// If this block already has an image, the first placeholder is almost
			// always that same image being rewritten — route it through
			// blu-edit-image (via callImageAbility) so we modify the existing
			// photo instead of discarding it and generating a brand-new one.
			// Mirrors the redirect in toolDispatcher's blu-generate-image branch.
			const { select: wpSelectForImage } = wp.data;
			const originalImageBlock = wpSelectForImage("core/block-editor").getBlock(args.client_id);
			const existingImageUrl = getBlockImageUrl(originalImageBlock);

			const imageUrls = [];
			for (let i = 0; i < promptCount; i++) {
				const prompt = args.image_prompts[i];
				const { prompt: promptText, ...restPromptOpts } =
					typeof prompt === "string" ? { prompt } : { prompt: prompt.prompt, ...prompt };
				const sourceUrl = i === 0 ? existingImageUrl : null;

				await ctx.updateProgress(
					(sourceUrl
						? __("Editing image…", "wp-module-editor-chat")
						: __("Generating image…", "wp-module-editor-chat")) + ` (${i + 1}/${promptCount})`,
					500
				);
				logger.log(
					`[ToolExecutor:REST] edit-block: ${sourceUrl ? "editing" : "generating"} image ${i + 1}/${promptCount}`,
					{ prompt: promptText, sourceUrl, ...restPromptOpts }
				);
				try {
					const mcpResult = await callImageAbility(ctx.mcpClient, {
						prompt: promptText,
						sourceUrl,
						...restPromptOpts,
					});
					logger.log(`[ToolExecutor:REST] edit-block: image ${i + 1} MCP result`, mcpResult);
					if (!mcpResult.isError && mcpResult.content?.[0]?.text) {
						const parsed = JSON.parse(mcpResult.content[0].text);
						const url = parsed?.message?.url || parsed?.url;
						if (url) {
							imageUrls.push(url);
							appendGeneratedImageUrl(url);
						} else {
							console.warn(
								`[ToolExecutor:REST] edit-block: image ${i + 1} result had no URL`,
								parsed
							);
						}
					} else {
						console.warn(
							`[ToolExecutor:REST] edit-block: image ${i + 1} MCP result flagged as error or empty`,
							mcpResult
						);
					}
				} catch (imgErr) {
					console.error(`[ToolExecutor:REST] edit-block: image ${i + 1} generation threw`, imgErr);
				}
			}

			for (let i = 0; i < imageUrls.length; i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, imageUrls[i]);
			}
		} else if (args.image_urls && Array.isArray(args.image_urls) && args.image_urls.length > 0) {
			for (let i = 0; i < args.image_urls.length; i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, args.image_urls[i]);
			}
		} else if (getGeneratedImageUrls().length > 0) {
			const cached = getGeneratedImageUrls();
			for (let i = 0; i < Math.min(cached.length, uniquePlaceholders.length); i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, cached[i]);
			}
		}
	}

	// If any placeholder is still present after the image step, log loudly —
	// the block would otherwise render a broken <img src="__IMG_N__">.
	const leftover = args.block_content.match(/__IMG_\d+__/g);
	if (leftover && leftover.length > 0) {
		console.warn(
			"[ToolExecutor:REST] edit-block: placeholders left unresolved — block will render with broken image URLs",
			leftover
		);
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	// ── Auto-deduplicate images ──
	if (getGeneratedImageUrls().length > 0) {
		const dedup = deduplicateImages(args.block_content, getGeneratedImageUrls());
		if (dedup.replacements.length > 0) {
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
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: false,
								error: `This block has ${innerCount} inner blocks — rewriting ${args.block_content.length} chars of markup at once risks broken output. Use a smaller tool instead: (1) For style/spacing/color/content changes, use blu-update-block-attrs on this block or its children — no markup needed. (2) For adding new content, use blu-add-section with before/after_client_id. (3) For structural reorganization, use blu-move-block and blu-delete-block.`,
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
