import { __ } from "@wordpress/i18n";

import { handleDeleteAction } from "../blockActions";

export async function handleDeleteBlock(toolCall, args, ctx) {
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
