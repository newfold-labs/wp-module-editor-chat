/* global describe, expect, test */

const {
	collectFontFamiliesFromSettings,
	normalizeFontFamilyEntry,
	supplementFontFamiliesFromExperimentalFeatures,
} = require("../../../src/services/globalStylesService");

describe("collectFontFamiliesFromSettings", () => {
	test("returns empty lists when typography is missing", () => {
		expect(collectFontFamiliesFromSettings({})).toEqual({
			theme: [],
			custom: [],
			fontFamilies: [],
		});
	});

	test("parses theme/custom nested presets", () => {
		const result = collectFontFamiliesFromSettings({
			typography: {
				fontFamilies: {
					theme: [
						{ slug: "ubuntu-sans", name: "Ubuntu Sans", fontFamily: '"Ubuntu Sans", sans-serif' },
					],
					custom: [{ slug: "brand-serif", name: "Brand Serif", fontFamily: "Georgia, serif" }],
				},
			},
		});

		expect(result.fontFamilies).toHaveLength(2);
		expect(result.fontFamilies.map((f) => f.slug)).toEqual(["ubuntu-sans", "brand-serif"]);
	});

	test("dedupes by slug when theme and custom overlap", () => {
		const entry = { slug: "system-font", name: "System", fontFamily: "system-ui" };
		const result = collectFontFamiliesFromSettings({
			typography: { fontFamilies: { theme: [entry], custom: [entry] } },
		});
		expect(result.fontFamilies).toHaveLength(1);
	});
});

describe("normalizeFontFamilyEntry", () => {
	test("rejects entries without slug", () => {
		expect(normalizeFontFamilyEntry({ name: "No slug" })).toBeNull();
	});
});

describe("supplementFontFamiliesFromExperimentalFeatures", () => {
	const themePreset = {
		slug: "playfair-display",
		name: "Playfair",
		fontFamily: "serif",
	};

	const editorSettings = {
		__experimentalFeatures: {
			typography: {
				fontFamilies: {
					theme: [themePreset],
				},
			},
		},
	};

	test("merges theme presets when entity only has custom fonts", () => {
		const customOnly = {
			fontFamilies: [{ slug: "ubuntu-sans", name: "Ubuntu", fontFamily: "sans" }],
			themeFontFamilies: [],
			customFontFamilies: [{ slug: "ubuntu-sans", name: "Ubuntu", fontFamily: "sans" }],
		};

		const result = supplementFontFamiliesFromExperimentalFeatures(customOnly, editorSettings);
		expect(result.fontFamilies.map((f) => f.slug).sort()).toEqual(
			["playfair-display", "ubuntu-sans"].sort()
		);
		expect(result.themeFontFamilies).toHaveLength(1);
	});

	test("replaces empty font list from features", () => {
		const empty = { fontFamilies: [], themeFontFamilies: [], customFontFamilies: [] };
		const result = supplementFontFamiliesFromExperimentalFeatures(empty, editorSettings);
		expect(result.fontFamilies).toHaveLength(1);
		expect(result.themeFontFamilies[0].slug).toBe("playfair-display");
	});
});