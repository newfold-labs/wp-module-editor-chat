import { __ } from "@wordpress/i18n";

import { handleDeleteAction } from "../blockActions";
import { removeBlockFromTemplate, wantsTemplateScope } from "../templateEditor";

export async function handleDeleteBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Deleting block…", "wp-module-editor-chat"), 400);
	try {
		let deleteResult;
		try {
			deleteResult = await handleDeleteAction({
				client_id: args.client_id,
				label: args.label,
			});
		} catch (blockError) {
			// Template blocks are edit-disabled while a page is open. Widening to
			// the template entity needs consent, since it changes every page using
			// the template. Either the model says so explicitly, having asked and
			// been told yes, or the user's own wording did. A bare confirmation
			// like "yes" carries no keywords, so the flag is the reliable signal.
			const isTemplateRefusal = /part of the template/i.test(blockError.message || "");
			const scopeConfirmed =
				args.from_template === true ||
				args.template === true ||
				args.scope === "template" ||
				wantsTemplateScope(ctx.userMessage);
			if (!isTemplateRefusal || !scopeConfirmed) {
				throw blockError;
			}
			const { select: wpSelect } = wp.data;
			const target = wpSelect("core/block-editor").getBlock(args.client_id);
			deleteResult = await removeBlockFromTemplate(args.client_id, target?.name || "block");
		}
		await ctx.updateProgress(__("Block deleted successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({
						success: true,
						message: deleteResult.message,
						...(deleteResult.menu_items ? { menu_items: deleteResult.menu_items } : {}),
					}),
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
