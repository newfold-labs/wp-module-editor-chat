import { __ } from "@wordpress/i18n";

import { deepMergeAttrs as deepMerge } from "../../utils/deepMerge";
import { appendGeneratedImageUrl } from "../imageCache";
import { callImageAbility, getBlockImageUrl, parseImageAbilityUrl } from "../imageAbility";
import { IMAGE_BLOCKS } from "../blockToolbar/blockAI";

export async function handleUpdateBlockAttrs(toolCall, args, ctx) {
	const { select: wpSelect, dispatch: wpDispatch } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const block = blockEditor.getBlock(args.client_id);

	if (!block) {
		return {
			id: toolCall.id,
			result: [
				{ type: "text", text: JSON.stringify({ success: false, error: "Block not found" }) },
			],
			isError: true,
		};
	}

	try {
		// Ensure attributes is always an object so `in` / property access is safe.
		args.attributes = args.attributes || {};

		// ── Generate or edit image from prompt if provided ──
		// Routes to blu-edit-image when the block already has a URL, otherwise blu-generate-image.
		if (args.image_prompt && !args.attributes.url) {
			const imgOpts =
				typeof args.image_prompt === "string"
					? { prompt: args.image_prompt }
					: { prompt: args.image_prompt.prompt, ...args.image_prompt };
			const sourceUrl = getBlockImageUrl(block);
			const progressLabel = sourceUrl
				? __("Editing image…", "wp-module-editor-chat")
				: __("Generating image…", "wp-module-editor-chat");
			try {
				await ctx.updateProgress(progressLabel, 500);
				const mcpResult = await callImageAbility(ctx.mcpClient, {
					...imgOpts,
					sourceUrl,
				});
				const url = parseImageAbilityUrl(mcpResult);
				if (url) {
					args.attributes.url = url;
					appendGeneratedImageUrl(url);
				}
			} catch {
				// image generation/edit failed — non-critical
			}
		}

		// ── Normalize common attribute name mistakes ──
		// The AI often sends "textAlign" but WordPress blocks use "align" for
		// text alignment on paragraphs, headings, etc.
		const TEXT_ALIGN_BLOCKS = new Set([
			"core/paragraph",
			"core/heading",
			"core/verse",
			"core/preformatted",
			"core/list",
			"core/quote",
			"core/pullquote",
		]);
		if (
			"textAlign" in args.attributes &&
			!("align" in args.attributes) &&
			TEXT_ALIGN_BLOCKS.has(block.name)
		) {
			args.attributes.align = args.attributes.textAlign;
			delete args.attributes.textAlign;
		}

		if (args.attributes.url && IMAGE_BLOCKS.has(block.name) && !("id" in args.attributes)) {
			args.attributes.id = 0;
		}

		// Detect no-op for content changes (text already matches)
		if ("content" in args.attributes) {
			const stripTags = (html) => (html || "").replace(/<[^>]+>/g, "").trim();
			const oldPlain = stripTags(block.attributes.content || "");
			const newPlain = stripTags(args.attributes.content || "");
			if (oldPlain === newPlain) {
				return {
					id: toolCall.id,
					result: [
						{
							type: "text",
							text: JSON.stringify({
								success: true,
								message: `Text is already "${oldPlain.substring(0, 60)}" — no change needed`,
							}),
						},
					],
					isError: false,
					hasChanges: false,
				};
			}
		}

		// Auto-clear conflicting preset/custom color attributes.
		// WordPress treats preset slugs (textColor, backgroundColor) and custom
		// styles (style.color.text, style.color.background) as mutually exclusive.
		// If both are present, the preset wins and the custom value is ignored.
		// This mirrors what the WordPress color picker UI does.
		const customText = args.attributes?.style?.color?.text;
		const customBg = args.attributes?.style?.color?.background;
		if (customText && block.attributes.textColor && !("textColor" in args.attributes)) {
			args.attributes.textColor = null;
		}
		if (customBg && block.attributes.backgroundColor && !("backgroundColor" in args.attributes)) {
			args.attributes.backgroundColor = null;
		}
		// Also handle the reverse: if setting a preset, clear the custom style
		if (args.attributes.textColor && block.attributes?.style?.color?.text) {
			if (!args.attributes.style) {
				args.attributes.style = {};
			}
			if (!args.attributes.style.color) {
				args.attributes.style.color = {};
			}
			args.attributes.style.color.text = null;
		}
		if (args.attributes.backgroundColor && block.attributes?.style?.color?.background) {
			if (!args.attributes.style) {
				args.attributes.style = {};
			}
			if (!args.attributes.style.color) {
				args.attributes.style.color = {};
			}
			args.attributes.style.color.background = null;
		}

		// Deep-merge new attributes into existing ones (null removes keys)
		const merged = deepMerge(block.attributes, args.attributes);
		wpDispatch("core/block-editor").updateBlockAttributes(args.client_id, merged);

		// Build descriptive result message
		let message = "Attributes updated";
		if ("content" in args.attributes) {
			const stripTags = (html) => (html || "").replace(/<[^>]+>/g, "").trim();
			const newPlain = stripTags(args.attributes.content || "");
			message = `Text set to "${newPlain.substring(0, 60)}"`;
		} else if ("url" in args.attributes) {
			message = "Image URL updated";
		}

		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: true, message }) }],
			isError: false,
			hasChanges: true,
		};
	} catch (err) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }],
			isError: true,
		};
	}
}
