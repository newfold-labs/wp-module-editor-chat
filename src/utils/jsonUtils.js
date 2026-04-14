/**
 * Safe JSON parsing with recovery for truncated/malformed strings.
 *
 * Extracted from toolExecutor.js to share between streamCompletion
 * (useEditorChatREST) and tool argument parsing (toolExecutor).
 */

/**
 * Parse a JSON string with recovery for trailing junk or truncation.
 *
 * 1. Tries JSON.parse directly.
 * 2. On failure, scans for the first complete top-level {} object using
 *    brace-depth tracking (handles string literals and escapes).
 * 3. Returns `fallback` if recovery also fails.
 *
 * @param {string} str      The JSON string to parse
 * @param {*}      fallback Value to return when parsing and recovery both fail (default: {})
 * @return {{ value: *, recovered: boolean }} Parsed value and whether recovery was used
 */
export function safeParseJSON(str, fallback = {}) {
	if (!str) {
		return { value: fallback, recovered: false };
	}
	try {
		return { value: JSON.parse(str), recovered: false };
	} catch {
		// Trailing junk or truncation — extract first complete {} object
		let depth = 0;
		let inStr = false;
		let esc = false;
		for (let i = 0; i < str.length; i++) {
			const ch = str[i];
			if (esc) {
				esc = false;
				continue;
			}
			if (ch === "\\" && inStr) {
				esc = true;
				continue;
			}
			if (ch === '"') {
				inStr = !inStr;
				continue;
			}
			if (inStr) {
				continue;
			}
			if (ch === "{") {
				depth++;
			}
			if (ch === "}") {
				depth--;
				if (depth === 0) {
					try {
						const value = JSON.parse(str.substring(0, i + 1));
						// eslint-disable-next-line no-console
						console.warn("[safeParseJSON] Recovered truncated JSON — trailing junk stripped");
						return { value, recovered: true };
					} catch {
						// Brace counting found a boundary but content is still invalid
						break;
					}
				}
			}
		}
		// eslint-disable-next-line no-console
		console.warn("[safeParseJSON] Could not recover JSON, using fallback");
		return { value: fallback, recovered: true };
	}
}
