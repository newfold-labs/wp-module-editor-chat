import { __ } from "@wordpress/i18n";

import { appendGeneratedImageUrl, getActiveImageEditTarget } from "../imageCache";
import { callImageAbility, parseImageAbilityUrl } from "../imageAbility";
import { IMAGE_BLOCKS, LOGO_BLOCK } from "../blockToolbar/blockAI";

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
		}

		// Detect logo context — if the target block is core/site-logo, do NOT update
		// it directly here; instead tell the AI to call blu-set-logo-from-image.
		const clientId = args.client_id || getActiveImageEditTarget();
		const targetBlock = clientId ? wp.data.select("core/block-editor").getBlock(clientId) : null;
		const isLogoContext = targetBlock?.name === LOGO_BLOCK;
		const appliedToBlock =
			!!url && !isLogoContext && !!targetBlock && IMAGE_BLOCKS.has(targetBlock.name);

		if (appliedToBlock) {
			wp.data.dispatch("core/block-editor").updateBlockAttributes(clientId, {
				url,
				id: 0,
			});
		}

		let resultPayload;
		if (!url) {
			resultPayload = { success: false, error: "Image edit failed — no URL returned." };
		} else if (isLogoContext) {
			// Logo block — URL was not applied directly; AI must call blu-set-logo-from-image.
			resultPayload = {
				success: true,
				message:
					"Image processed. Call blu-set-logo-from-image with this URL to set it as the site logo.",
				url,
				next_step: `Call blu-set-logo-from-image(source_url="${url}")`,
			};
		} else if (appliedToBlock) {
			resultPayload = { success: true, message: "Image edited and applied to the block.", url };
		} else {
			// URL returned but no target block — return the URL so the AI can place it.
			resultPayload = { success: true, message: "Image processed.", url };
		}

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(resultPayload) }],
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
