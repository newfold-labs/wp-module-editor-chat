import { __ } from "@wordpress/i18n";

import { validateBlockMarkup } from "../../utils/blockValidator";
import { handleInsertInnerBlockAction } from "../blockActions";
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

		let intendedAttrs = parseNavigationLinkAttrsFromMarkup(rawMarkup);
		if (intendedAttrs?.id != null) {
			intendedAttrs = await resolvePageNavigationAttrs(intendedAttrs);
			await assertNavigationPageExists(intendedAttrs);
		}

		let finalMarkup = rawMarkup;
		if (intendedAttrs?.id != null) {
			finalMarkup = buildNavigationLinkMarkup({
				label: intendedAttrs.label,
				type: intendedAttrs.type || "page",
				id: intendedAttrs.id,
				kind: intendedAttrs.kind || "post-type",
				url: intendedAttrs.url,
			});
		} else {
			const validation = validateBlockMarkup(rawMarkup);
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
			finalMarkup = validation.correctedContent || rawMarkup;
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
