import { callAbility } from "./callAbility";
import { IMAGE_BLOCKS } from "./blockToolbar/blockAI";

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
