/* global describe, expect, it */

const { formatRelativeTime, parseGmtTimestamp } = require("../relativeTime");

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

describe("parseGmtTimestamp", () => {
	it("reads a MySQL GMT timestamp as UTC", () => {
		expect(parseGmtTimestamp("2026-11-10 12:00:00")).toBe(NOW);
	});

	it("returns null for empty or invalid input", () => {
		expect(parseGmtTimestamp("")).toBeNull();
		expect(parseGmtTimestamp(undefined)).toBeNull();
		expect(parseGmtTimestamp("not a date")).toBeNull();
	});
});

describe("formatRelativeTime", () => {
	it("says 'now' for the last few seconds", () => {
		expect(formatRelativeTime("2026-11-10 11:59:58", NOW, "en")).toBe("now");
	});

	it("formats minutes", () => {
		expect(formatRelativeTime("2026-11-10 11:45:00", NOW, "en")).toBe("15 minutes ago");
	});

	it("formats hours", () => {
		expect(formatRelativeTime("2026-11-10 09:00:00", NOW, "en")).toBe("3 hours ago");
	});

	it("formats days", () => {
		expect(formatRelativeTime("2026-11-08 12:00:00", NOW, "en")).toBe("2 days ago");
	});

	it("falls back to a calendar date after a month", () => {
		expect(formatRelativeTime("2026-08-01 12:00:00", NOW, "en")).toMatch(/2026/);
	});

	it("returns an empty string when the timestamp is unusable", () => {
		expect(formatRelativeTime("", NOW, "en")).toBe("");
	});

	it("never reports a future time", () => {
		expect(formatRelativeTime("2026-11-10 12:30:00", NOW, "en")).toBe("now");
	});
});
