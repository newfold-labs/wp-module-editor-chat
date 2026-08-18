import { __ } from "@wordpress/i18n";

import { validateBlockMarkup } from "../../utils/blockValidator";
import { findImagePlaceholders, substituteImagePlaceholders } from "../../utils/imagePlaceholders";
import { handleInsertInnerBlockAction } from "../blockActions";
import { resolveImagePrompts } from "../imageAbility";
import { getGeneratedImages, unresolvedPlaceholderResult } from "../imageCache";
import {
	buildNavigationLinkMarkup,
	parseNavigationLinkAttrsFromMarkup,
	resolvePageNavigationAttrs,
	assertNavigationPageExists,
} from "../navigationEditor";

export async function handleInsertInnerBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Inserting block…", "wp-module-editor-chat"), 400);
	try {
		// Strip escaped quotes the LLM may copy from JSON-encoded tool results
		const rawMarkup = (args.block_content || args.block_markup || "").replace(/\\"/g, '"').trim();

		// ── Image placeholder resolution (mirrors add-section) ──
		// "Add an image inside this group" routes here rather than to add-section,
		// so this path needs the same generation and the same refusal to write an
		// unresolved placeholder into the page.
		const placeholders = findImagePlaceholders(rawMarkup);
		let generationAttempted = false;
		let generatedCount = 0;
		let markup = rawMarkup;

		if (placeholders.length > 0) {
			if (Array.isArray(args.image_prompts) && args.image_prompts.length > 0) {
				generationAttempted = true;
				const images = await resolveImagePrompts(args.image_prompts, ctx, {
					limit: placeholders.length,
				});
				generatedCount = images.length;
				markup = substituteImagePlaceholders(markup, images);
			} else if (Array.isArray(args.image_urls) && args.image_urls.length > 0) {
				markup = substituteImagePlaceholders(
					markup,
					args.image_urls.map((url) => ({ url }))
				);
			} else if (getGeneratedImages().length > 0) {
				markup = substituteImagePlaceholders(markup, getGeneratedImages());
			}
		}

		const unresolved = unresolvedPlaceholderResult(toolCall.id, markup, {
			attempted: generationAttempted,
			generated: generatedCount,
		});
		if (unresolved) {
			console.warn(
				"[ToolExecutor:REST] insert-inner-block: placeholders left unresolved: insert rejected",
				findImagePlaceholders(markup)
			);
			return unresolved;
		}

		let intendedAttrs = parseNavigationLinkAttrsFromMarkup(markup);
		if (intendedAttrs?.id != null) {
			intendedAttrs = await resolvePageNavigationAttrs(intendedAttrs);
			await assertNavigationPageExists(intendedAttrs);
		}

		let finalMarkup = markup;
		if (intendedAttrs?.id != null) {
			finalMarkup = buildNavigationLinkMarkup({
				label: intendedAttrs.label,
				type: intendedAttrs.type || "page",
				id: intendedAttrs.id,
				kind: intendedAttrs.kind || "post-type",
				url: intendedAttrs.url,
			});
		} else {
			const validation = validateBlockMarkup(markup);
			if (!validation.valid) {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({ success: false, error: validation.error }),
						},
					],
					isError: true,
				};
			}
			finalMarkup = validation.correctedContent || markup;
		}

		const index = typeof args.index === "number" ? args.index : null;
		const insResult = await handleInsertInnerBlockAction(
			args.parent_client_id,
			finalMarkup,
			index,
			intendedAttrs
		);
		await ctx.updateProgress(__("Block inserted successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({
						success: true,
						message: insResult.message,
						inserted_client_ids: insResult.insertedClientIds,
						...(insResult.alreadyPresent ? { already_present: true } : {}),
						...(insResult.menu_items ? { menu_items: insResult.menu_items } : {}),
					}),
				},
			],
			isError: false,
			hasChanges: insResult.hasChanges !== false,
		};
	} catch (insError) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: insError.message }) }],
			isError: true,
		};
	}
}
