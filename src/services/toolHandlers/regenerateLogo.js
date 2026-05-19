import { __ } from "@wordpress/i18n";

import { callAbility } from "../callAbility";

export async function handleRegenerateLogo(toolCall, args, ctx) {
	await ctx.updateProgress(__("Generating logo…", "wp-module-editor-chat"), 500);
	try {
		const mcpResult = await callAbility(ctx.mcpClient, "blu-regenerate-logo", args);
		const result = {
			id: toolCall.id,
			result: mcpResult.content,
			isError: mcpResult.isError || false,
			hasChanges: !mcpResult.isError,
		};

		// Invalidate the site entity in the block editor store so the
		// core/site-logo block re-fetches and re-renders with the new logo.
		if (!result.isError) {
			try {
				wp.data
					.dispatch("core")
					.invalidateResolution("getEntityRecord", ["root", "site", undefined]);
			} catch {
				// Non-critical — logo was saved, editor refresh will show on reload
			}
		}

		return result;
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
			isError: true,
		};
	}
}
