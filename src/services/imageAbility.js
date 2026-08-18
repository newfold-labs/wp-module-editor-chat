import { dispatch } from "@wordpress/data";
import { __ } from "@wordpress/i18n";

import { callAbility } from "./callAbility";
import { appendGeneratedImageUrl } from "./imageCache";
import { IMAGE_BLOCKS } from "./blockToolbar/blockAI";
import { resolveAlt } from "../utils/imageAlt";
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
 * Shared by add-section, edit-block and insert-inner-block so all three resolve
 * placeholders the same way. Failures are collected rather than thrown: the
 * caller's unresolved-placeholder guard decides what a partial run means, and it
 * is the only place that can tell the model what to do about it.
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
				console.warn(`[imageAbility] image ${i + 1}/${count} returned no URL`, mcpResult);
				continue;
			}
			const resolvedAlt = resolveAlt(alt, prompt);
			images.push({ url, alt: resolvedAlt });
			appendGeneratedImageUrl(url, resolvedAlt);
			logger.log(`[imageAbility] image ${i + 1}/${count} ready`, { prompt, sourceUrl, url });
		} catch (err) {
			console.error(`[imageAbility] image ${i + 1}/${count} threw`, err);
		}
	}

	return images;
}
