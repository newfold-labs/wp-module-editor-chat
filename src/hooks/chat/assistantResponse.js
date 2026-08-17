/**
 * Structured assistant JSON responses.
 *
 * The model always replies with a JSON object:
 *   {"message":"…"}                          — normal plan / reply
 *   {"message":"…","need_blocks_markup":[…]} — request block markup (no tools)
 */
import { select } from "@wordpress/data";
import { __ } from "@wordpress/i18n";

import { safeParseJSON } from "../../utils/jsonUtils";
import { getSelectedBlocks } from "../../utils/editorHelpers";

/** Max blocks whose markup may be injected per request. */
export const MAX_MARKUP_CLIENT_IDS = 2;

/** Max markup-request rounds per user turn (prevents infinite loops). */
export const MAX_MARKUP_REQUESTS_PER_TURN = 2;

/**
 * Nudge used on the iteration after markup has been injected.
 */
export const MARKUP_PROVIDED_NUDGE = `The requested block markup is now in editor_context under "Target block markup". Reply with JSON only, then call the editing tool(s):
{"message":"One short sentence for the user"}
Do not include need_blocks_markup again.`;

/**
 * Parse the assistant's JSON response.
 *
 * @param {string} content Raw assistant text
 * @return {{ message: string, need_blocks_markup?: string[] }|null} Parsed payload or null
 */
export function parseAssistantResponse(content) {
	if (!content || !content.trim()) {
		return null;
	}

	const normalize = (obj) => {
		if (!obj) {
			return null;
		}
		const result = { message: obj?.message?.trim() ?? "" };
		const ids = obj.need_blocks_markup;
		if (Array.isArray(ids) && ids.length > 0) {
			result.need_blocks_markup = ids
				.filter((id) => typeof id === "string" && id.length > 0)
				.slice(0, MAX_MARKUP_CLIENT_IDS);
		}
		return result;
	};

	const trimmed = content.trim();

	// Plain prose: the model ignored the JSON contract entirely. This happens
	// often enough that it must not be treated as a parse failure: running it
	// through safeParseJSON is what produced the "[safeParseJSON] Could not
	// recover JSON" console noise, and returning null makes the caller fall back
	// to the raw string, skipping sanitization. Detect it before parsing.
	if (!trimmed.includes('"message"') && !trimmed.includes("need_blocks_markup")) {
		return { message: trimmed };
	}

	const direct = safeParseJSON(trimmed);
	const fromDirect = normalize(direct.value);

	// Only return early if we actually got a non-empty message — normalize({})
	// returns { message: "" } (truthy) when safeParseJSON falls back to {}, which
	// would suppress the regex fallback below and cause raw JSON to leak into the UI.
	if (fromDirect?.message) {
		return fromDirect;
	}

	const match = trimmed.match(/\{[\s\S]*"message"[\s\S]*\}/);
	if (match) {
		const extracted = safeParseJSON(match[0]);
		const fromExtracted = normalize(extracted.value);
		if (fromExtracted?.message) {
			return fromExtracted;
		}
	}

	const loose = extractMessageLoosely(trimmed);
	const looseIds = extractNeedBlocksLoosely(trimmed);
	if (loose || looseIds) {
		return {
			message: loose || __("Reading the current page content…", "wp-module-editor-chat"),
			...(looseIds ? { need_blocks_markup: looseIds } : {}),
		};
	}
	return null;
}

/**
 * Salvage the message from JSON the model broke — usually an unescaped quote in
 * the message itself, which otherwise leaks the whole raw object into the chat.
 * The greedy capture stops at the last quote before the close, keeping inner ones.
 *
 * @param {string} text Trimmed assistant output
 * @return {string|null} Message text, or null if not recoverable
 */
function extractMessageLoosely(text) {
	const unescape = (s) => s.replace(/\\"/g, '"').replace(/\\n/g, "\n").trim() || null;
	// A salvaged "message" still carrying a contract key is structural garbage,
	// not prose: it means the model broke the object shape itself (seen as
	// `{"message":"need_blocks_markup":[…]}`). Better no message than that.
	const clean = (s) => (s && !s.includes("need_blocks_markup") ? s : null);

	const match = text.match(/"message"\s*:\s*"([\s\S]*)"\s*(?:,\s*"need_blocks_markup"|\}|$)/);
	if (match) {
		return clean(unescape(match[1]));
	}

	// Unterminated string: output was cut off mid-message, so there is no
	// closing quote for the greedy pattern above to anchor on. Take everything
	// after the opening quote; without this the raw JSON leaks into the chat.
	const openEnded = text.match(/"message"\s*:\s*"([\s\S]*)$/);
	return openEnded ? clean(unescape(openEnded[1])) : null;
}

/**
 * Salvage need_blocks_markup ids from JSON the model broke structurally.
 *
 * Seen in the wild as `{"message":"need_blocks_markup":[…]}`: two colons, no
 * value for message. Nothing can parse that, so the markup request used to be
 * dropped silently and the model re-asked for the same blocks every turn without
 * ever making progress.
 *
 * @param {string} text Trimmed assistant output
 * @return {string[]|null} Client ids, or null if none found
 */
function extractNeedBlocksLoosely(text) {
	const match = text.match(/"need_blocks_markup"\s*:\s*\[([^\]]*)\]/);
	if (!match) {
		return null;
	}
	const ids = match[1].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
	return ids?.length ? ids.slice(0, MAX_MARKUP_CLIENT_IDS) : null;
}

/**
 * Strip developer-facing tokens from text shown to site owners.
 *
 * @param {string} text Raw assistant message
 * @return {string} Sanitized message
 */
export function sanitizeUserFacingMessage(text) {
	if (!text || typeof text !== "string") {
		return text || "";
	}

	let out = text;
	// UUIDs (block clientIds leaked into prose)
	out = out.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "");
	// id:uuid / (id:uuid) patterns from block-tree citations
	out = out.replace(/\(?\s*id:\s*[0-9a-f-]{36}\s*\)?/gi, "");
	// Linked navigation entity refs
	out = out.replace(/\bref:\s*\d+/gi, "");
	out = out.replace(/\bref:N\b/gi, "");
	// Block type slugs
	out = out.replace(/\bcore\/[\w-]+\b/g, "");
	// wp_navigation and similar internal terms
	out = out.replace(/\bwp_navigation\b/gi, "");
	out = out.replace(/\s+([,.;:!?])/g, "$1");
	out = out.replace(/\s{2,}/g, " ").trim();
	return out;
}

/**
 * User-visible text extracted from an assistant response.
 *
 * @param {string} content Raw assistant text
 * @return {string} Message for the chat UI
 */
export function getAssistantDisplayMessage(content) {
	const parsed = parseAssistantResponse(content);
	if (parsed?.message) {
		return sanitizeUserFacingMessage(parsed.message);
	}
	return sanitizeUserFacingMessage(content || "");
}

/**
 * Whether a markup request may be honored for the current editor state.
 *
 * @return {boolean} True when no block is selected in the editor.
 */
export function canRequestBlockMarkup() {
	return getSelectedBlocks().length === 0;
}

/**
 * Keep only clientIds that exist in the block editor.
 *
 * @param {string[]} clientIds Candidate ids
 * @return {string[]} Valid ids (max {@link MAX_MARKUP_CLIENT_IDS})
 */
export function filterValidMarkupClientIds(clientIds) {
	const blockEditor = select("core/block-editor");
	const seen = new Set();
	const valid = [];
	for (const id of clientIds || []) {
		if (!id || seen.has(id)) {
			continue;
		}
		if (!blockEditor.getBlock(id)) {
			continue;
		}
		seen.add(id);
		valid.push(id);
		if (valid.length >= MAX_MARKUP_CLIENT_IDS) {
			break;
		}
	}
	return valid;
}
