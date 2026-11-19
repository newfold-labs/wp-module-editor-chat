/* global describe, expect, jest, test */

jest.mock("../../../src/services/globalStylesService", () => ({
	getCurrentGlobalStyles: jest.fn(() => ({
		fontFamilies: [{ slug: "playfair-display", name: "Playfair", fontFamily: "serif" }],
	})),
}));

const {
	getRequestedFontFamilySlug,
	validateThemeFontFamilySlug,
} = require("../../../src/utils/fontFamilyValidation");

describe("getRequestedFontFamilySlug", () => {
	test("reads top-level fontFamily", () => {
		expect(getRequestedFontFamilySlug({ fontFamily: "playfair-display" })).toBe("playfair-display");
	});

	test("reads preset token in style.typography", () => {
		expect(
			getRequestedFontFamilySlug({
				style: { typography: { fontFamily: "var:preset|font-family|ubuntu-sans" } },
			})
		).toBe("ubuntu-sans");
	});
});

describe("validateThemeFontFamilySlug", () => {
	test("allows registered slug", () => {
		expect(validateThemeFontFamilySlug({ fontFamily: "playfair-display" })).toBeNull();
	});

	test("rejects unknown slug", () => {
		const result = validateThemeFontFamilySlug({ fontFamily: "comic-sans-ms" });
		expect(result?.error).toContain("comic-sans-ms");
		expect(result.allowedSlugs).toContain("playfair-display");
	});

	test("rejects raw font stack in style.typography", () => {
		const result = validateThemeFontFamilySlug({
			style: { typography: { fontFamily: "Comic Sans MS, cursive" } },
		});
		expect(result?.error).toContain("Custom font stacks");
	});
});