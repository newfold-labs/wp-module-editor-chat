/**
 * Tool handlers for blu-get-global-styles and blu-update-global-styles.
 */
import { __ } from "@wordpress/i18n";

import { callAbility } from "../callAbility";
import { getCurrentGlobalStyles, updateGlobalStyles } from "../globalStylesService";
import {
	userCanEditGlobalStyles,
	validateGlobalStylesFontPatch,
} from "../../utils/fontFamilyValidation";

export async function handleUpdateGlobalStyles(toolCall, args, ctx) {
	if (!userCanEditGlobalStyles()) {
		return {
			toolResult: {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({
							success: false,
							error: __(
								"You do not have permission to change site-wide styles. Ask an administrator, or change the font on the selected block only.",
								"wp-module-editor-chat"
							),
							code: "rest_forbidden",
						}),
					},
				],
				isError: true,
			},
			globalStylesUndoData: null,
		};
	}

	await ctx.updateProgress(__("Reading current styles…", "wp-module-editor-chat"), 500);

	const fontPatchError = validateGlobalStylesFontPatch(args.settings, args.styles);
	if (fontPatchError) {
		return {
			toolResult: {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({
							success: false,
							error: fontPatchError.error,
							allowed_font_slugs: fontPatchError.allowedSlugs,
						}),
					},
				],
				isError: true,
			},
			globalStylesUndoData: null,
		};
	}

	// Validate palette items — filter out corrupt entries from truncated responses
	try {
		for (const key of ["theme", "custom"]) {
			const palette = args.settings?.color?.palette?.[key];
			if (Array.isArray(palette)) {
				const cleaned = palette.filter((p) => p && p.slug && p.color);
				if (cleaned.length < palette.length) {
					args.settings.color.palette[key] = cleaned;
				}
			}
		}
	} catch {
		/* non-critical */
	}

	try {
		await ctx.updateProgress(
			__("Applying style changes to your site…", "wp-module-editor-chat"),
			600
		);
		const jsResult = await updateGlobalStyles(args.settings, args.styles);

		if (jsResult.success) {
			await ctx.updateProgress(__("✓ Styles saved to your site.", "wp-module-editor-chat"), 800);

			if (jsResult.undoData && !ctx.originalGlobalStylesRef.current) {
				ctx.originalGlobalStylesRef.current = jsResult.undoData;
			}
			const globalStylesUndoData = ctx.originalGlobalStylesRef.current || null;

			const { undoData: _unused, ...resultForAI } = jsResult;
			return {
				toolResult: {
					id: toolCall.id,
					result: [{ type: "text", text: JSON.stringify(resultForAI) }],
					isError: false,
					hasChanges: true,
				},
				globalStylesUndoData,
			};
		}
		await ctx.updateProgress(__("Retrying with alternative method…", "wp-module-editor-chat"), 400);
	} catch {
		await ctx.updateProgress(__("Retrying with alternative method…", "wp-module-editor-chat"), 400);
	}

	// Fallback to MCP
	const result = await callAbility(ctx.mcpClient, toolCall.name, toolCall.arguments);
	return {
		toolResult: {
			id: toolCall.id,
			result: result.content,
			isError: result.isError,
		},
		globalStylesUndoData: null,
	};
}

export async function handleGetGlobalStyles(toolCall, ctx) {
	await ctx.updateProgress(__("Reading site color palette…", "wp-module-editor-chat"), 500);

	try {
		await ctx.updateProgress(__("Analyzing theme settings…", "wp-module-editor-chat"), 600);
		const jsResult = getCurrentGlobalStyles();

		if (jsResult.palette?.length > 0 || jsResult.fontFamilies?.length > 0 || jsResult.rawSettings) {
			const colorCount = jsResult.palette?.length || 0;
			const fontCount = jsResult.fontFamilies?.length || 0;
			await ctx.updateProgress(
				fontCount > 0
					? `✓ Found ${colorCount} colors and ${fontCount} font preset(s)`
					: `✓ Found ${colorCount} colors in palette`,
				700
			);
			return {
				id: toolCall.id,
				result: [
					{
						type: "text",
						text: JSON.stringify({
							styles: jsResult,
							message: "Retrieved global styles from editor",
						}),
					},
				],
				isError: false,
			};
		}
		await ctx.updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
	} catch {
		await ctx.updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
	}

	// Fallback to MCP
	const result = await callAbility(ctx.mcpClient, toolCall.name, toolCall.arguments);
	return {
		id: toolCall.id,
		result: result.content,
		isError: result.isError,
	};
}
