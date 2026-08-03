/**
 * Structured assistant JSON responses.
 *
 * The model always replies with a JSON object:
 *   {"message":"…"}                          — normal plan / reply
 *   {"message":"…","need_blocks_markup":[…]} — request block markup (no tools)
 */
import { select } from "@wordpress/data";

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
	return loose ? { message: loose } : null;
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
	const match = text.match(/"message"\s*:\s*"([\s\S]*)"\s*(?:,\s*"need_blocks_markup"|\}|$)/);
	if (!match) {
		return null;
	}
	return match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").trim() || null;
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
