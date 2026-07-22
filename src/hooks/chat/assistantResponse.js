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
	let fromDirect = normalize(direct.value);

	// Only return early if we actually got a non-empty message — normalize({})
	// returns { message: "" } (truthy) when safeParseJSON falls back to {}, which
	// would suppress the regex fallback below and cause raw JSON to leak into the UI.
	if (fromDirect?.message) {
		return fromDirect;
	}

	// The model occasionally over-escapes quotes inside the message value
	// (\\" instead of \"), especially when its own prior JSON replies appear
	// earlier in the conversation history (e.g. after resuming a chat). Try
	// once with that specific pattern repaired before falling back to raw text.
	const repaired = safeParseJSON(trimmed.replace(/\\\\"/g, '\\"'));
	fromDirect = normalize(repaired.value);
	if (fromDirect?.message) {
		return fromDirect;
	}

	const match = trimmed.match(/\{[\s\S]*"message"[\s\S]*\}/);
	if (match) {
		const extracted = safeParseJSON(match[0]);
		const fromMatch = normalize(extracted.value);
		if (fromMatch?.message) {
			return fromMatch;
		}
	}

	// Last resort: the model left quotes inside the message value completely
	// unescaped (e.g. `"...to "Click here"."}`), which breaks JSON parsing in
	// a way no amount of repair above can fix — there's no way to tell content
	// quotes from structural ones without knowing where the value ends. Since
	// the format is always a single top-level "message" field, assume greedily
	// that everything between the first `"message":"` and the last `"}` at the
	// end of the string IS the message, unescaped quotes and all.
	const lenient = trimmed.match(/"message"\s*:\s*"([\s\S]*)"\s*\}\s*$/);
	if (lenient && lenient[1]) {
		return { message: lenient[1].trim() };
	}

	return null;
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
		return parsed.message;
	}
	return content || "";
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
