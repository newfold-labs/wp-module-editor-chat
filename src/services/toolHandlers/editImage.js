import { __ } from "@wordpress/i18n";

import { appendGeneratedImageUrl, getActiveImageEditTarget } from "../imageCache";
import { callImageAbility, parseImageAbilityUrl } from "../imageAbility";
import { IMAGE_BLOCKS } from "../blockToolbar/blockAI";

export async function handleEditImage(toolCall, args, ctx) {
	if (!args.prompt) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({
						error: "Missing required parameter: prompt. Describe how to edit the image.",
					}),
				},
			],
			isError: true,
		};
	}

	if (!args.source_url) {
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({
						error: "Missing required parameter: source_url. Provide the current image URL to edit.",
					}),
				},
			],
			isError: true,
		};
	}

	await ctx.updateProgress(__("Editing image…", "wp-module-editor-chat"), 500);

	try {
		const mcpResult = await callImageAbility(ctx.mcpClient, {
			prompt: args.prompt,
			sourceUrl: args.source_url,
			orientation: args.orientation,
			width: args.width,
			height: args.height,
			quality: args.quality,
			fit: args.fit,
			background: args.background,
			trim: args.trim,
		});

		const url = parseImageAbilityUrl(mcpResult);
		if (url) {
			appendGeneratedImageUrl(url);

			// Apply the new URL directly to the target block. The AI rarely passes
			// client_id, so fall back to the active image-edit target recorded when
			// the request was sent.
			const clientId = args.client_id || getActiveImageEditTarget();
			if (clientId) {
				const block = wp.data.select("core/block-editor").getBlock(clientId);
				if (block && IMAGE_BLOCKS.has(block.name)) {
					wp.data.dispatch("core/block-editor").updateBlockAttributes(clientId, {
						url,
						id: 0,
					});
				}
			}
		}

		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify(
						url
							? { success: true, message: "Image edited successfully.", url }
							: { success: false, error: "Image edit failed — no URL returned." }
					),
				},
			],
			isError: mcpResult.isError || !url,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
			isError: true,
		};
	}
}