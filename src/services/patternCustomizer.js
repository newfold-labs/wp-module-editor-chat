/* eslint-disable no-undef, no-console */
/**
 * Pattern content customization via the backend AI.
 *
 * Parses a pattern's block markup, extracts human-readable text blocks,
 * and rewrites them via the NFD Agents backend (same AI that handles chat)
 * so the content fits the site and page context.
 *
 * Uses a temporary WebSocket connection to the backend gateway — no
 * separate AI client or new endpoints required.
 */

import apiFetch from "@wordpress/api-fetch";

/**
 * Text-bearing block types whose content should be customized in patterns.
 */
const TEXT_BLOCK_TYPES = new Set([
	"core/heading",
	"core/paragraph",
	"core/button",
	"core/list-item",
]);

/**
 * Get the block name from a parsed block object.
 * wp.blocks.parse() returns `name`, the grammar parser returns `blockName`.
 *
 * @param {Object} block Parsed block object.
 * @return {string|null} Block name or null.
 */
function getBlockName(block) {
	return block.blockName || block.name || null;
}

/**
 * Get the raw HTML content from a parsed block object.
 * wp.blocks.parse() returns `originalContent`, the grammar parser returns `innerHTML`.
 *
 * @param {Object} block Parsed block object.
 * @return {string} HTML content string.
 */
function getBlockHTML(block) {
	return block.innerHTML || block.originalContent || "";
}

/**
 * Walk a parsed block tree and collect leaf text blocks.
 *
 * @param {Array} blocks Parsed blocks from wp.blocks.parse().
 * @param {Array} result Accumulator.
 * @return {Array} Flat list of text block references (with html accessor).
 */
function collectTextBlocks(blocks, result = []) {
	for (const block of blocks) {
		const name = getBlockName(block);
		const html = getBlockHTML(block);
		if (TEXT_BLOCK_TYPES.has(name) && html.trim()) {
			result.push(block);
		}
		if (block.innerBlocks?.length) {
			collectTextBlocks(block.innerBlocks, result);
		}
	}
	return result;
}

// ────────────────────────────────────────────────────────────────────
// Backend AI completion via temporary WebSocket
// ────────────────────────────────────────────────────────────────────

/** Cached gateway config to avoid repeated REST calls. */
let cachedConfig = null;

/**
 * Fetch gateway config (cached after first call).
 *
 * @return {Promise<Object>} Config with gateway_url, brand_id, agent_type, token, site_url.
 */
async function getGatewayConfig() {
	if (cachedConfig) {
		return cachedConfig;
	}
	const config = await apiFetch({
		path: "nfd-agents/chat/v1/config?consumer=editor_chat",
	});
	if (!config?.gateway_url) {
		throw new Error("Missing gateway_url in config");
	}
	cachedConfig = config;
	return config;
}

/**
 * Build a WebSocket URL for a temporary backend connection.
 *
 * @param {Object} config  Gateway config from getGatewayConfig().
 * @param {string} sessionId Unique session ID for this connection.
 * @return {string} Full WebSocket URL.
 */
function buildWsUrl(config, sessionId) {
	let base = config.gateway_url.replace(/\/$/, "");
	base = base.replace("https://", "wss://").replace("http://", "ws://");
	if (!base.startsWith("ws")) {
		base = base.includes("localhost") ? `ws://${base}` : `wss://${base}`;
	}

	const agentType = config.agent_type === "nfd-agents" ? "blu" : config.agent_type;
	const token = config.huapi_token || config.jarvis_jwt;
	const siteUrl = config.site_url || window.location.origin;

	return (
		`${base}/${config.brand_id}/agents/${agentType}/v1/ws` +
		`?session_id=${encodeURIComponent(sessionId)}` +
		`&token=${encodeURIComponent(token)}` +
		`&consumer=${encodeURIComponent("wordpress_editor_chat")}` +
		`&site_url=${encodeURIComponent(siteUrl)}`
	);
}

/**
 * Send a prompt to the backend AI via a temporary WebSocket connection
 * and return the full response text.
 *
 * Opens a fresh connection, sends one message, collects the streamed
 * response, then closes. Timeout ensures we don't hang indefinitely.
 *
 * @param {string} prompt    The prompt to send.
 * @param {number} timeoutMs Max wait time (default 30 s).
 * @return {Promise<string>} The AI's response text.
 */
async function requestBackendCompletion(prompt, timeoutMs = 30000) {
	const config = await getGatewayConfig();
	const sessionId = `pc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const wsUrl = buildWsUrl(config, sessionId);

	return new Promise((resolve, reject) => {
		let responseText = "";
		let settled = false;
		let sessionReady = false;

		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				ws.close();
			} catch {}
			fn(value);
		};

		const timer = setTimeout(
			() => finish(reject, new Error("Pattern customization timed out")),
			timeoutMs
		);

		const ws = new WebSocket(wsUrl);

		ws.onopen = () => {
			// Fallback: if session_established never arrives, send after 600 ms
			setTimeout(() => {
				if (!sessionReady && !settled) {
					sessionReady = true;
					ws.send(JSON.stringify({ type: "chat", message: prompt }));
				}
			}, 600);
		};

		ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				if (data.type === "session_established") {
					if (!sessionReady) {
						sessionReady = true;
						ws.send(JSON.stringify({ type: "chat", message: prompt }));
					}
				} else if (data.type === "streaming_chunk" || data.type === "chunk") {
					responseText += data.content || data.message || "";
				} else if (data.type === "message" || data.type === "complete") {
					if (data.message) {
						responseText = data.message;
					}
					finish(resolve, responseText);
				} else if (data.type === "error") {
					finish(reject, new Error(data.message || "Backend AI error"));
				}
				// Ignore typing_start, typing_stop, tool_call, structured_output, etc.
			} catch {
				// Non-JSON or malformed — ignore
			}
		};

		ws.onerror = () => finish(reject, new Error("WebSocket connection error"));

		ws.onclose = () => {
			if (!settled) {
				if (responseText) {
					finish(resolve, responseText);
				} else {
					finish(reject, new Error("Connection closed without response"));
				}
			}
		};
	});
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Customize pattern text via the backend AI.
 *
 * Parses the pattern, extracts text blocks, rewrites their content via
 * the NFD Agents backend, then applies the changes via string replacement
 * on the **original** markup — no re-serialization, so layout / styles /
 * attrs are guaranteed to remain untouched.
 *
 * Falls back to the original markup on any error (graceful degradation).
 *
 * @param {string} patternMarkup   Original block markup from the library.
 * @param {Object} ctx             Context for the AI.
 * @param {string} ctx.pageTitle   Current page title.
 * @param {string} ctx.userMessage The user's original request.
 * @return {Promise<string>} Customized markup (or original on failure).
 */
export async function customizePatternContent(patternMarkup, ctx) {
	let blocks;
	try {
		blocks = wp.blocks.parse(patternMarkup);
	} catch {
		return patternMarkup;
	}

	const textBlocks = collectTextBlocks(blocks);
	if (textBlocks.length === 0) {
		return patternMarkup;
	}

	// Build items for AI — send trimmed HTML so the AI works with clean snippets
	const textItems = textBlocks.map((block, idx) => ({
		id: idx,
		type: getBlockName(block).replace("core/", ""),
		html: getBlockHTML(block).trim(),
	}));

	const site = window.nfdEditorChat?.site || {};

	try {
		const prompt =
			"You rewrite website pattern text. The blocks below are from a template with generic placeholder content. " +
			"Rewrite ALL text so it fits the website and page described below. " +
			"Keep every HTML tag, class, attribute, and href value identical — change ONLY the text between/inside tags. " +
			"Keep approximately the same length and tone for each block. " +
			"Return ONLY a JSON array with `id` and `html` fields. No explanation, no markdown fences.\n\n" +
			`Site: "${site.title || ""}"\n` +
			(site.description ? `Description: "${site.description}"\n` : "") +
			(site.siteType ? `Type: ${site.siteType}\n` : "") +
			`Page: "${ctx.pageTitle || ""}"\n` +
			(ctx.userMessage ? `User request: "${ctx.userMessage}"\n` : "") +
			`\nText blocks:\n${JSON.stringify(textItems, null, 2)}`;

		const raw = await requestBackendCompletion(prompt);
		if (!raw) {
			return patternMarkup;
		}

		const jsonMatch = raw.match(/\[[\s\S]*\]/);
		if (!jsonMatch) {
			return patternMarkup;
		}

		const customized = JSON.parse(jsonMatch[0]);

		// Apply replacements to the original markup via string substitution.
		// Each block's HTML is an exact substring of the original markup, so indexOf works.
		let result = patternMarkup;
		let searchFrom = 0;

		for (const item of customized) {
			const block = textBlocks[item.id];
			if (!block || !item.html) {
				continue;
			}

			const oldInner = getBlockHTML(block);
			// Preserve the original leading/trailing whitespace, swap only the trimmed content
			const newInner = oldInner.replace(oldInner.trim(), item.html.trim());

			const pos = result.indexOf(oldInner, searchFrom);
			if (pos !== -1) {
				result =
					result.substring(0, pos) + newInner + result.substring(pos + oldInner.length);
				searchFrom = pos + newInner.length;
			}
		}

		return result;
	} catch (err) {
		console.warn("[customizePatternContent] Backend customization failed, using original:", err);
		return patternMarkup;
	}
}
