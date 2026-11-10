/* global beforeEach, describe, expect, it, jest */

jest.mock("@wordpress/data", () => ({ select: jest.fn() }));
jest.mock("@wordpress/blocks", () => ({ serialize: jest.fn(), getBlockTypes: jest.fn(() => []) }));

const { select } = require("@wordpress/data");
const { getCurrentPageModified, getCurrentPageType, isModifiedNewer } = require("../editorHelpers");

const mockEditor = (editor) => select.mockImplementation(() => editor);

describe("page identity helpers", () => {
	beforeEach(() => {
		select.mockReset();
	});

	describe("getCurrentPageType", () => {
		it("returns the current post type", () => {
			mockEditor({ getCurrentPostType: () => "page" });

			expect(getCurrentPageType()).toBe("page");
		});

		it("returns an empty string when the type is unavailable", () => {
			mockEditor({ getCurrentPostType: () => undefined });

			expect(getCurrentPageType()).toBe("");
		});
	});

	describe("getCurrentPageModified", () => {
		it("replaces the T separator with a space", () => {
			mockEditor({ getCurrentPost: () => ({ modified: "2026-11-10T09:30:00" }) });

			expect(getCurrentPageModified()).toBe("2026-11-10 09:30:00");
		});

		it("returns an empty string when there is no post", () => {
			mockEditor({ getCurrentPost: () => null });

			expect(getCurrentPageModified()).toBe("");
		});

		it("returns an empty string when the post has no modified date", () => {
			mockEditor({ getCurrentPost: () => ({}) });

			expect(getCurrentPageModified()).toBe("");
		});
	});

	describe("isModifiedNewer", () => {
		it("is true when the current value is later", () => {
			expect(isModifiedNewer("2026-11-10 11:00:00", "2026-11-10 10:00:00")).toBe(true);
		});

		it("is false when equal", () => {
			expect(isModifiedNewer("2026-11-10 10:00:00", "2026-11-10 10:00:00")).toBe(false);
		});

		it("is false when earlier", () => {
			expect(isModifiedNewer("2026-11-09 10:00:00", "2026-11-10 10:00:00")).toBe(false);
		});

		it("is false when either side is empty", () => {
			expect(isModifiedNewer("", "2026-11-10 10:00:00")).toBe(false);
			expect(isModifiedNewer("2026-11-10 10:00:00", "")).toBe(false);
			expect(isModifiedNewer(undefined, null)).toBe(false);
		});
	});
});
