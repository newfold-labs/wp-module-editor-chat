/* global beforeEach, describe, expect, jest, test */

jest.mock("@wordpress/data", () => ({
	dispatch: jest.fn(),
	select: jest.fn(),
}));
jest.mock("../callAbility", () => ({ callAbility: jest.fn() }));
jest.mock("../imageCache", () => ({
	appendGeneratedImageUrl: jest.fn(),
	getGeneratedImages: jest.fn(() => []),
}));
jest.mock("../blockToolbar/blockAI", () => ({
	IMAGE_BLOCKS: new Set(["core/image", "core/cover"]),
}));

const { dispatch, select } = require("@wordpress/data");
const { applyImageToBlock } = require("../imageAbility");

describe("applyImageToBlock", () => {
	const updateBlockAttributes = jest.fn();
	const getBlock = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
		dispatch.mockReturnValue({ updateBlockAttributes });
		select.mockReturnValue({ getBlock });
	});

	test("returns true only when the editor contains the generated URL after dispatch", () => {
		getBlock.mockReturnValue({
			clientId: "image-1",
			name: "core/image",
			attributes: { url: "https://example.com/generated.jpg" },
		});

		expect(
			applyImageToBlock("image-1", "https://example.com/generated.jpg", "Office employees")
		).toBe(true);
	});

	test("returns false when Gutenberg did not apply the generated URL", () => {
		getBlock.mockReturnValue({
			clientId: "image-1",
			name: "core/image",
			attributes: {},
		});

		expect(
			applyImageToBlock("image-1", "https://example.com/generated.jpg", "Office employees")
		).toBe(false);
	});
});
