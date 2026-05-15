import { __ } from "@wordpress/i18n";

import { handleDuplicateAction } from "../blockActions";

export async function handleDuplicate(toolCall, args, ctx) {
	await ctx.updateProgress(__("Duplicating block…", "wp-module-editor-chat"), 400);
	try {
		const dupResult = await handleDuplicateAction({
			client_id: args.client_id,
			kind: args.kind,
			scope: args.scope,
			position: args.position,
		});
		await ctx.updateProgress(__("Block duplicated successfully", "wp-module-editor-chat"), 500);
		const payload = {
			success: true,
			message: dupResult.message,
			new_client_id: dupResult.newClientId,
			source_client_id: dupResult.clientId,
			block_name: dupResult.blockName,
			new_subtree: dupResult.newSubtree,
		};
		if (dupResult.resolution) {
			payload.resolution = dupResult.resolution;
		}
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(payload) }],
			isError: false,
			hasChanges: true,
		};
	} catch (dupError) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: dupError.message }) }],
			isError: true,
		};
	}
}
