import { __ } from "@wordpress/i18n";

import { resolveAlt } from "../utils/imageAlt";
import { callAbility } from "./callAbility";
import {
	appendGeneratedImageUrl,
	deduplicateImages,
	getGeneratedImages,
	substituteImagePlaceholder,
} from "./imageCache";

/**
 * Resolve __IMG_N__ placeholders in Gutenberg markup (generate, urls, or cache).
 *
 * @param {string} markup Markup that may contain __IMG_N__ placeholders.
 * @param {Object} args   Tool args (image_prompts, image_urls).
 * @param {Object} ctx    Tool execution context (mcpClient, updateProgress).
 * @return {Promise<string>} Markup with placeholders substituted when possible.
 */
export async function resolveMarkupImagePlaceholders(markup, args, ctx) {
	if (!markup || typeof markup !== "string") {
		return markup;
	}

	let next = markup;
	const imgPlaceholders = next.match(/__IMG_\d+__/g) || [];
	const uniquePlaceholders = [...new Set(imgPlaceholders)];

	if (uniquePlaceholders.length > 0) {
		if (args.image_prompts && Array.isArray(args.image_prompts) && args.image_prompts.length > 0) {
			const promptCount = Math.min(args.image_prompts.length, uniquePlaceholders.length);
			const images = [];
			for (let i = 0; i < promptCount; i++) {
				const prompt = args.image_prompts[i];
				const imgArgs =
					typeof prompt === "string" ? { prompt } : { prompt: prompt.prompt, ...prompt };
				const suppliedAlt = typeof prompt === "string" ? "" : prompt.alt;

				if (typeof ctx.updateProgress === "function") {
					await ctx.updateProgress(
						__("Generating image…", "wp-module-editor-chat") + ` (${i + 1}/${promptCount})`,
						500
					);
				}
				try {
					const mcpResult = await callAbility(ctx.mcpClient, "blu-generate-image", imgArgs);
					if (!mcpResult.isError && mcpResult.content?.[0]?.text) {
						const parsed = JSON.parse(mcpResult.content[0].text);
						const url = parsed?.message?.url || parsed?.url;
						if (url) {
							const alt = resolveAlt(suppliedAlt, imgArgs.prompt);
							images.push({ url, alt });
							appendGeneratedImageUrl(url, alt);
						}
					}
				} catch {
					// image generation failed — non-critical
				}
			}

			for (let i = 0; i < images.length; i++) {
				next = substituteImagePlaceholder(next, i + 1, images[i].url, images[i].alt);
			}
		} else if (args.image_urls && Array.isArray(args.image_urls) && args.image_urls.length > 0) {
			for (let i = 0; i < args.image_urls.length; i++) {
				next = substituteImagePlaceholder(next, i + 1, args.image_urls[i]);
			}
		} else if (getGeneratedImages().length > 0) {
			const cached = getGeneratedImages();
			for (let i = 0; i < Math.min(cached.length, uniquePlaceholders.length); i++) {
				next = substituteImagePlaceholder(next, i + 1, cached[i].url, cached[i].alt);
			}
		}
	}

	if (getGeneratedImages().length > 0) {
		const dedup = deduplicateImages(next, getGeneratedImages());
		if (dedup.replacements.length > 0) {
			next = dedup.markup;
		}
	}

	return next;
}
