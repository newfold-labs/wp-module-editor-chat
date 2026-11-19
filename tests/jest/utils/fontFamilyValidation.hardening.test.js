/* global describe, expect, jest, test, beforeEach */

jest.mock("../../../src/services/globalStylesService", () => ({
	getCurrentGlobalStyles: jest.fn(() => ({
		fontFamilies: [
			{ slug: "playfair-display", name: "Playfair", fontFamily: "serif" },
			{ slug: "ubuntu-sans", name: "Ubuntu", fontFamily: "sans" },
		],
	})),
}));

const {
	applyFontFamilyClassNameToAttributes,
	buildHasFontFamilyClassName,
	validateGlobalStylesFontPatch,
	userCanEditGlobalStyles,
} = require("../../../src/utils/fontFamilyValidation");

describe("buildHasFontFamilyClassName", () => {
	test("builds WP preset class", () => {
		expect(buildHasFontFamilyClassName("playfair-display")).toBe(
			"has-playfair-display-font-family"
		);
	});
});

describe("applyFontFamilyClassNameToAttributes", () => {
	test("adds has-*-font-family and drops other font preset classes", () => {
		const patch = applyFontFamilyClassNameToAttributes(
			{ fontFamily: "roboto-serif" },
			"has-playfair-display-font-family foo"
		);
		expect(patch.className).toBe("foo has-roboto-serif-font-family");
	});
});

describe("validateGlobalStylesFontPatch", () => {
	test("allows valid preset token in styles.typography", () => {
		expect(
			validateGlobalStylesFontPatch(null, {
				typography: { fontFamily: "var:preset|font-family|ubuntu-sans" },
			})
		).toBeNull();
	});

	test("rejects unknown slug", () => {
		const err = validateGlobalStylesFontPatch(null, {
			typography: { fontFamily: "var:preset|font-family|comic-sans-ms" },
		});
		expect(err?.allowedSlugs).toContain("playfair-display");
	});

	test("rejects raw font stack", () => {
		expect(
			validateGlobalStylesFontPatch(null, {
				elements: { heading: { typography: { fontFamily: "Georgia, serif" } } },
			})?.error
		).toContain("Custom font stacks");
	});
});

describe("userCanEditGlobalStyles", () => {
	beforeEach(() => {
		delete globalThis.window;
	});

	test("returns true when flag is set", () => {
		globalThis.window = { nfdEditorChat: { canEditThemeOptions: true } };
		expect(userCanEditGlobalStyles()).toBe(true);
	});

	test("returns false when flag is false", () => {
		globalThis.window = { nfdEditorChat: { canEditThemeOptions: false } };
		expect(userCanEditGlobalStyles()).toBe(false);
	});
});