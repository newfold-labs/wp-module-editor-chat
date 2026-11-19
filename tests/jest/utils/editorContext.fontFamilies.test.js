/* global afterEach, describe, expect, jest, test */

jest.mock("../../../src/utils/editorHelpers", () => ({
	buildCompactBlockTree: jest.fn(() => "(tree)"),
	getCurrentPageBlocks: jest.fn(() => []),
	getCurrentPageId: jest.fn(() => 1),
	getCurrentPageTitle: jest.fn(() => "Test"),
	getSelectedBlocks: jest.fn(() => []),
}));
jest.mock("../../../src/services/navigationEditor", () => ({
	buildNavigationMenuContextLines: jest.fn(),
	findRefNavigationBlocks: jest.fn(() => []),
}));
jest.mock("../../../src/services/blockToolbar/blockAI", () => ({
	IMAGE_BLOCKS: new Set(),
	LOGO_BLOCK: "core/site-logo",
}));
jest.mock("../../../src/services/imageAbility", () => ({
	getBlockImageUrl: jest.fn(),
}));
jest.mock("../../../src/utils/nfdClassReference", () => ({ NFD_CLASS_REFERENCE: "" }));

jest.mock("../../../src/services/globalStylesService", () => ({
	getCurrentGlobalStyles: jest.fn(),
}));

const { getCurrentGlobalStyles } = require("../../../src/services/globalStylesService");
const {
	buildEditorContext,
	formatFontFamiliesContextSection,
} = require("../../../src/utils/editorContext");

describe("formatFontFamiliesContextSection", () => {
	test("lists presets and applied global fonts", () => {
		const section = formatFontFamiliesContextSection(
			[{ slug: "playfair-display", name: "Playfair Display", fontFamily: "serif" }],
			{ body: "var:preset|font-family|ubuntu-sans" }
		);
		expect(section).toContain("playfair-display");
		expect(section).toContain("Applied site body font");
	});
});

describe("buildEditorContext font presets", () => {
	afterEach(() => {
		delete globalThis.wp;
		delete globalThis.window;
	});

	test("injects active fonts and typography guidance", () => {
		globalThis.window = {
			nfdEditorChat: { site: { title: "Demo" }, homeUrl: "https://example.test" },
			location: { origin: "https://example.test" },
		};
		globalThis.wp = {
			data: {
				select: (store) => {
					if (store === "core/editor") {
						return { getCurrentPostType: () => "page" };
					}
					return {};
				},
			},
			blocks: { serialize: jest.fn() },
		};

		getCurrentGlobalStyles.mockReturnValue({
			palette: [{ slug: "primary", color: "#000", name: "Primary" }],
			fontFamilies: [
				{ slug: "ubuntu-sans", name: "Ubuntu Sans", fontFamily: "sans-serif" },
			],
			appliedTypography: { body: "var(--wp--preset--font-family--ubuntu-sans)" },
		});

		const context = buildEditorContext();
		expect(context).toContain("Active theme font presets");
		expect(context).toContain("ubuntu-sans");
		expect(context).toContain("Font family guidance");
		expect(context).toContain("blu-update-block-attrs");
	});
});