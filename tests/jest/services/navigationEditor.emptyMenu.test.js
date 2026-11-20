/* global beforeEach, describe, expect, jest, test */

const mockSelect = jest.fn();
const mockParse = jest.fn(() => []);

// virtual: @wordpress/* packages are WP externals and are not installed in CI.
jest.mock(
	"@wordpress/data",
	() => ({
		dispatch: jest.fn(),
		select: (...args) => mockSelect(...args),
		resolveSelect: jest.fn(),
	}),
	{ virtual: true }
);
jest.mock(
	"@wordpress/blocks",
	() => ({
		serialize: jest.fn(),
		parse: (...args) => mockParse(...args),
		createBlock: jest.fn(),
	}),
	{ virtual: true }
);
jest.mock("@wordpress/api-fetch", () => jest.fn(), { virtual: true });
jest.mock("../../../src/utils/blockUtils", () => ({ createBlockFromParsed: jest.fn() }));
jest.mock("../../../src/utils/deepMerge", () => ({ deepMergeAttrs: jest.fn() }));
jest.mock("../../../src/services/templatePartEditor", () => ({
	insertBlocksAtPath: jest.fn(),
	replaceBlockAtPath: jest.fn(),
}));

const { buildNavigationMenuContextLines } = require("../../../src/services/navigationEditor");

const navBlock = { clientId: "nav-1", attributes: { ref: 12 } };
const blockEditor = { getBlocks: () => [] };

const mockEntity = (entity) => mockSelect.mockReturnValue({ getEntityRecord: () => entity });

describe("buildNavigationMenuContextLines with an empty linked menu", () => {
	beforeEach(() => {
		mockParse.mockClear();
		mockSelect.mockReset();
	});

	test("does not pass the content object to parse() when raw and rendered are empty", () => {
		mockEntity({ content: { raw: "", rendered: "", block_version: 0 } });

		const lines = buildNavigationMenuContextLines(navBlock, blockEditor);

		expect(mockParse).not.toHaveBeenCalled();
		expect(lines[0]).toContain("linked menu");
	});

	test("parses string content", () => {
		mockEntity({ content: { raw: "<!-- wp:navigation-link /-->" } });

		buildNavigationMenuContextLines(navBlock, blockEditor);

		expect(mockParse).toHaveBeenCalledWith("<!-- wp:navigation-link /-->");
	});
});
