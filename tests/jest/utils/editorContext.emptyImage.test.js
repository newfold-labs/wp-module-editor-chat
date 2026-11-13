/* global afterEach, describe, expect, jest, test */

jest.mock("../../../src/utils/editorHelpers", () => ({
	buildCompactBlockTree: jest.fn(),
	getCurrentPageBlocks: jest.fn(),
	getCurrentPageId: jest.fn(),
	getCurrentPageTitle: jest.fn(),
	getSelectedBlocks: jest.fn(),
}));
jest.mock("../../../src/services/globalStylesService", () => ({
	getCurrentGlobalStyles: jest.fn(),
}));
jest.mock("../../../src/services/navigationEditor", () => ({
	buildNavigationMenuContextLines: jest.fn(),
	findRefNavigationBlocks: jest.fn(),
}));
jest.mock("../../../src/services/blockToolbar/blockAI", () => ({
	IMAGE_BLOCKS: new Set(["core/image", "core/cover"]),
	LOGO_BLOCK: "core/site-logo",
}));
jest.mock("../../../src/services/imageAbility", () => ({
	getBlockImageUrl: jest.fn(() => null),
}));
jest.mock("../../../src/utils/nfdClassReference", () => ({ NFD_CLASS_REFERENCE: "" }));

const { formatImageEditUserMessage } = require("../../../src/utils/editorContext");

describe("empty image editor context", () => {
	afterEach(() => {
		delete globalThis.wp;
	});

	test("keeps the selected empty image clientId in the model-facing request", () => {
		globalThis.wp = {
			data: {
				select: () => ({
					getBlock: () => ({
						clientId: "image-empty",
						name: "core/image",
						attributes: {},
					}),
				}),
			},
		};

		expect(formatImageEditUserMessage("Generate an office image", "image-empty")).toContain(
			"core/image (id:image-empty)"
		);
	});
});
