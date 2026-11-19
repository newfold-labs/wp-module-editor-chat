/* global describe, expect, jest, test, beforeEach */

jest.mock("@wordpress/i18n", () => ({ __: (message) => message }), { virtual: true });

jest.mock("../../../src/services/callAbility", () => ({
	callAbility: jest.fn(),
}));

jest.mock("../../../src/services/globalStylesService", () => ({
	getCurrentGlobalStyles: jest.fn(() => ({
		fontFamilies: [
			{ slug: "ubuntu-sans", name: "Ubuntu", fontFamily: "sans" },
			{ slug: "playfair-display", name: "Playfair", fontFamily: "serif" },
		],
	})),
	updateGlobalStyles: jest.fn(),
}));

const { updateGlobalStyles } = require("../../../src/services/globalStylesService");
const { handleUpdateGlobalStyles } = require("../../../src/services/toolHandlers/globalStyles");

const toolCall = { id: "tc1", name: "blu-update-global-styles", arguments: "{}" };

describe("handleUpdateGlobalStyles permissions", () => {
	const ctx = {
		updateProgress: jest.fn(),
		originalGlobalStylesRef: { current: null },
		mcpClient: {},
	};

	beforeEach(() => {
		jest.clearAllMocks();
		delete globalThis.window;
	});

	test("blocks update when user cannot edit theme options", async () => {
		globalThis.window = { nfdEditorChat: { canEditThemeOptions: false } };
		const out = await handleUpdateGlobalStyles(
			toolCall,
			{ settings: {}, styles: {} },
			ctx
		);
		expect(out.toolResult.isError).toBe(true);
		expect(JSON.parse(out.toolResult.result[0].text).code).toBe("rest_forbidden");
		expect(updateGlobalStyles).not.toHaveBeenCalled();
	});

	test("rejects invalid font slug before applying", async () => {
		globalThis.window = { nfdEditorChat: { canEditThemeOptions: true } };
		const out = await handleUpdateGlobalStyles(
			toolCall,
			{
				settings: null,
				styles: { typography: { fontFamily: "var:preset|font-family|comic-sans-ms" } },
			},
			ctx
		);
		expect(out.toolResult.isError).toBe(true);
		expect(JSON.parse(out.toolResult.result[0].text).allowed_font_slugs).toBeDefined();
		expect(updateGlobalStyles).not.toHaveBeenCalled();
	});
});