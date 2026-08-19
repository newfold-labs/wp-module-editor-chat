import { dispatch } from "@wordpress/data";
import { __ } from "@wordpress/i18n";

import { callAbility } from "./callAbility";
import { appendGeneratedImageUrl, getGeneratedImages } from "./imageCache";
import { IMAGE_BLOCKS } from "./blockToolbar/blockAI";
import { resolveAlt } from "../utils/imageAlt";
import { findImagePlaceholders, substituteImagePlaceholders } from "../utils/imagePlaceholders";
import logger from "../utils/logger";

/**
 * Apply a generated image to an image block, alt text included.
 *
 * Gutenberg merges partial attribute patches, so writing only `{ url }` leaves
 * the previous alt in place, describing an image no longer on the page.
 *
 * @param {string} clientId Target block clientId
 * @param {string} url      New image URL
 * @param {string} [alt]    Alt text describing the new image
 */
export function applyImageToBlock(clientId, url, alt) {
	dispatch("core/block-editor").updateBlockAttributes(clientId, {
		url,
		id: 0,
		...(alt ? { alt } : {}),
	});
}

/**
 * Get the image URL for a block.
 * @param {Object} block
 * @return {string|null} The image URL for the block.
 */
export function getBlockImageUrl(block) {
	if (!block || !IMAGE_BLOCKS.has(block.name)) {
		return null;
	}

	const url = block.attributes?.url || null;
	if (!url) {
		return null;
	}

	// Cloudflare Image CDN proxy URLs embed the original URL after the transform params:
	// https://hiive.cloud/cdn-cgi/image/format=auto,width=430,height=430/https://origin.example.com/img.png
	// Extract the original so the backend can fetch the raw image bytes.
	const cdnMatch = url.match(/\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)/);
	return cdnMatch ? cdnMatch[1] : url;
}

/**
 * Parse the CDN URL from an MCP image ability response.
 *
 * @param {Object} mcpResult Result from callAbility / callImageAbility.
 * @return {string|null} The image URL from the MCP result.
 */
export function parseImageAbilityUrl(mcpResult) {
	if (mcpResult?.isError || !mcpResult?.content?.[0]?.text) {
		return null;
	}
	try {
		const parsed = JSON.parse(mcpResult.content[0].text);
		return parsed?.message?.url || parsed?.url || null;
	} catch {
		return null;
	}
}

/**
 * Call blu-edit-image when sourceUrl exists, otherwise blu-generate-image.
 *
 * @param {Object}      mcpClient
 * @param {Object}      params
 * @param {string}      params.prompt
 * @param {string|null} [params.sourceUrl]
 * @return {Promise<Object>} The result of the image ability call.
 */
export async function callImageAbility(mcpClient, { prompt, sourceUrl, ...opts }) {
	const ability = sourceUrl ? "blu-edit-image" : "blu-generate-image";
	const parameters = sourceUrl ? { prompt, source_url: sourceUrl, ...opts } : { prompt, ...opts };
	return callAbility(mcpClient, ability, parameters);
}

/**
 * Generate the images for a run of `__IMG_N__` placeholders.
 *
 * Failures are collected rather than thrown; the caller's unresolved-placeholder
 * guard decides what a partial run means.
 *
 * @param {Array<string|Object>} prompts                     `image_prompts` entries, string or {prompt, alt?, …}.
 * @param {Object}               ctx                         Tool context (mcpClient, updateProgress).
 * @param {Object}               [options]                   Options.
 * @param {number}               [options.limit]             Stop after this many prompts (the placeholder count).
 * @param {string|null}          [options.sourceUrlForFirst] Existing image the first prompt should edit rather than replace.
 * @return {Promise<Array<{url: string, alt: string}>>} Generated images, in prompt order.
 */
export async function resolveImagePrompts(prompts, ctx, { limit, sourceUrlForFirst = null } = {}) {
	const count = Math.min(prompts.length, limit ?? prompts.length);
	const images = [];

	for (let i = 0; i < count; i++) {
		const entry = prompts[i];
		const { prompt, alt, ...opts } = typeof entry === "string" ? { prompt: entry } : { ...entry };
		const sourceUrl = i === 0 ? sourceUrlForFirst : null;

		await ctx.updateProgress(
			(sourceUrl
				? __("Editing image…", "wp-module-editor-chat")
				: __("Generating image…", "wp-module-editor-chat")) + ` (${i + 1}/${count})`,
			500
		);

		try {
			const mcpResult = await callImageAbility(ctx.mcpClient, { prompt, sourceUrl, ...opts });
			const url = parseImageAbilityUrl(mcpResult);
			if (!url) {
				logger.warn(`[imageAbility] image ${i + 1}/${count} returned no URL`, mcpResult);
				continue;
			}
			const resolvedAlt = resolveAlt(alt, prompt);
			images.push({ url, alt: resolvedAlt });
			appendGeneratedImageUrl(url, resolvedAlt);
			logger.log(`[imageAbility] image ${i + 1}/${count} ready`, { prompt, sourceUrl, url });
		} catch (err) {
			logger.error(`[imageAbility] image ${i + 1}/${count} threw`, err);
		}
	}

	return images;
}

/**
 * Resolve every `__IMG_N__` placeholder in `markup`, whichever source is available.
 *
 * The write paths (add-section, edit-block, insert-inner-block) all offer the
 * same three: generate from `image_prompts`, substitute caller-supplied
 * `image_urls`, or reuse images already generated this turn.
 *
 * @param {string} markup                      Block markup, possibly carrying placeholders.
 * @param {Object} args                        Tool args (image_prompts, image_urls).
 * @param {Object} ctx                         Tool context.
 * @param {Object} [options]                   Options.
 * @param {string} [options.sourceUrlForFirst] Existing image the first prompt should edit.
 * @return {Promise<{markup: string, attempted: boolean, generated: number}>} Resolved markup and
 *   what generation did, for unresolvedPlaceholderResult().
 */
export async function resolveMarkupImages(markup, args, ctx, { sourceUrlForFirst = null } = {}) {
	const placeholders = findImagePlaceholders(markup);
	if (placeholders.length === 0) {
		return { markup, attempted: false, generated: 0 };
	}

	if (Array.isArray(args.image_prompts) && args.image_prompts.length > 0) {
		const images = await resolveImagePrompts(args.image_prompts, ctx, {
			limit: placeholders.length,
			sourceUrlForFirst,
		});
		return {
			markup: substituteImagePlaceholders(markup, images),
			attempted: true,
			generated: images.length,
		};
	}

	const fallback =
		Array.isArray(args.image_urls) && args.image_urls.length > 0
			? args.image_urls.map((url) => ({ url }))
			: getGeneratedImages();

	return {
		markup: substituteImagePlaceholders(markup, fallback),
		attempted: false,
		generated: 0,
	};
}
