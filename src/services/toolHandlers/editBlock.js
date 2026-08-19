import { __ } from "@wordpress/i18n";

import { validateBlockMarkup } from "../../utils/blockValidator";
import { findImagePlaceholders } from "../../utils/imagePlaceholders";
import { handleRewriteAction } from "../blockActions";
import { getBlockImageUrl, resolveMarkupImages } from "../imageAbility";
import { deduplicateImages, getGeneratedImages, unresolvedPlaceholderResult } from "../imageCache";

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
	// If this block already has an image, the first placeholder is almost always
	// that same image being rewritten — route it through blu-edit-image so we
	// modify the existing photo instead of generating a brand-new one.
	const originalImageBlock = wp.data.select("core/block-editor").getBlock(args.client_id);
	const images = await resolveMarkupImages(args.block_content, args, ctx, {
		sourceUrlForFirst: getBlockImageUrl(originalImageBlock),
	});
	args.block_content = images.markup;

	// Fail rather than write a placeholder through as a broken image.
	const unresolved = unresolvedPlaceholderResult(toolCall.id, args.block_content, images);
	if (unresolved) {
		console.warn(
			"[ToolExecutor:REST] edit-block: placeholders left unresolved: edit rejected",
			findImagePlaceholders(args.block_content)
		);
		return unresolved;
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	// ── Auto-deduplicate images ──
	if (getGeneratedImages().length > 0) {
		const dedup = deduplicateImages(args.block_content, getGeneratedImages());
		if (dedup.replacements.length > 0) {
			args.block_content = dedup.markup;
		}
	}

	// ── Guard: reject extremely large rewrites on very complex blocks ──
	// For moderate structural edits (e.g. splitting columns into rows),
	// we let the edit through — the validation + safe merge path below
	// catches broken markup and lost inner blocks. Only block truly
	// massive rewrites that are almost certainly truncated AI output.
	// Skipped for core/post-content: a whole-page redesign is legitimately large.
	{
		const { select: wpSel } = wp.data;
		const targetBlock = wpSel("core/block-editor").getBlock(args.client_id);
		if (targetBlock && targetBlock.name !== "core/post-content") {
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

	// Skipped for core/post-content: a page body legitimately has many top-level
	// blocks, which these guards would read as inner-block loss.
	if (
		originalBlock &&
		originalBlock.name !== "core/post-content" &&
		originalBlock.innerBlocks.length > 0 &&
		validation.blocks?.length >= 1
	) {
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
