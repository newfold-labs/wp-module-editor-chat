import { __ } from "@wordpress/i18n";

import { callAbility } from "../callAbility";

export async function handleSetLogoFromImage(toolCall, args, ctx) {
	await ctx.updateProgress(__("Applying logo…", "wp-module-editor-chat"), 500);
	try {
		const mcpResult = await callAbility(ctx.mcpClient, "blu-set-logo-from-image", args);
		if (!mcpResult.isError) {
			// Force core/site-logo to re-fetch and re-render with the new logo
			wp.data.dispatch("core").invalidateResolution("getEntityRecord", ["root", "site", undefined]);
		}
		return {
			id: toolCall.id,
			result: mcpResult.content,
			isError: mcpResult.isError || false,
			hasChanges: !mcpResult.isError,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
			isError: true,
		};
	}
}
