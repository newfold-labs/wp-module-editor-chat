/**
 * Relative-time formatting for conversation history rows.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

/**
 * Parse a MySQL GMT timestamp ("YYYY-MM-DD HH:MM:SS") as UTC.
 *
 * @param {string} value Timestamp from the server.
 * @return {number|null} Epoch milliseconds, or null when unusable.
 */
export function parseGmtTimestamp(value) {
	if (typeof value !== "string" || !value) {
		return null;
	}
	const time = Date.parse(`${value.replace(" ", "T")}Z`);
	return Number.isFinite(time) ? time : null;
}

/**
 * Describe how long ago a server timestamp was.
 *
 * @param {string} value    MySQL GMT timestamp.
 * @param {number} [now]    Current epoch milliseconds (injectable for tests).
 * @param {string} [locale] BCP 47 locale; defaults to the document language.
 * @return {string} Text such as "3 hours ago", a calendar date after a month, or "" when unusable.
 */
export function formatRelativeTime(
	value,
	now = Date.now(),
	locale = typeof document !== "undefined" ? document.documentElement.lang || undefined : undefined
) {
	const time = parseGmtTimestamp(value);
	if (time === null) {
		return "";
	}
	const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	const elapsed = Math.max(0, now - time);

	if (elapsed < MINUTE) {
		return formatter.format(0, "second");
	}
	if (elapsed < HOUR) {
		return formatter.format(-Math.floor(elapsed / MINUTE), "minute");
	}
	if (elapsed < DAY) {
		return formatter.format(-Math.floor(elapsed / HOUR), "hour");
	}
	if (elapsed < MONTH) {
		return formatter.format(-Math.floor(elapsed / DAY), "day");
	}
	return new Date(time).toLocaleDateString(locale);
}
