/* global beforeEach, describe, expect, it, jest */

jest.mock("@wordpress/data", () => ({ select: jest.fn() }));
jest.mock("@wordpress/blocks", () => ({ serialize: jest.fn(), getBlockTypes: jest.fn(() => []) }));

const { select } = require("@wordpress/data");
const {
	getCurrentPageModified,
	getCurrentPageType,
	getCurrentStoredPageId,
	isModifiedNewer,
	toStoredPageId,
} = require("../../../src/utils/editorHelpers");

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

	describe("toStoredPageId", () => {
		it("keeps positive integer post ids", () => {
			expect(toStoredPageId(7)).toBe(7);
			expect(toStoredPageId("12")).toBe(12);
		});

		it("returns 0 for template and other non-numeric entity ids", () => {
			expect(toStoredPageId("theme//home")).toBe(0);
			expect(toStoredPageId("twentytwentyfive//header")).toBe(0);
		});

		it("returns 0 for empty, zero and invalid values", () => {
			expect(toStoredPageId(undefined)).toBe(0);
			expect(toStoredPageId(null)).toBe(0);
			expect(toStoredPageId(0)).toBe(0);
			expect(toStoredPageId(-3)).toBe(0);
			expect(toStoredPageId("7abc")).toBe(0);
		});
	});

	describe("getCurrentStoredPageId", () => {
		it("returns the numeric id of the open post", () => {
			mockEditor({ getCurrentPostId: () => 7 });

			expect(getCurrentStoredPageId()).toBe(7);
		});

		it("returns 0 when a template is open", () => {
			mockEditor({ getCurrentPostId: () => "theme//home" });

			expect(getCurrentStoredPageId()).toBe(0);
		});
	});
});
