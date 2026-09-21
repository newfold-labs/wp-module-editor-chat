/* global beforeEach, describe, expect, jest, test */

const mockUpdateBlockAttributes = jest.fn();
const mockEnsureMenuBlockAccessible = jest.fn();

jest.mock("../navigationEditor", () => ({
	applyNavigationLinkAttrPatch: jest.fn(),
	normalizeNavigationLinkAttrs: jest.fn((attributes) => attributes),
	resolveRefNavigationForEdit: jest.fn(() => null),
	updateNavigationLinkAttributes: jest.fn(),
	ensureMenuBlockAccessible: (...args) => mockEnsureMenuBlockAccessible(...args),
}));

jest.mock("../imageAbility", () => ({
	callImageAbility: jest.fn(),
	getBlockImageUrl: jest.fn(),
	parseImageAbilityUrl: jest.fn(),
}));

jest.mock("../blockToolbar/blockAI", () => ({
	IMAGE_BLOCKS: new Set(["core/image", "core/cover"]),
	LOGO_BLOCK: "core/site-logo",
}));

import { appendGeneratedImageUrl, resetGeneratedImageCache } from "../imageCache";
import { handleUpdateBlockAttrs } from "../toolHandlers/updateBlockAttrs";

describe("update block attributes with a generated image", () => {
	beforeEach(() => {
		resetGeneratedImageCache();
		mockUpdateBlockAttributes.mockReset();
		mockEnsureMenuBlockAccessible.mockReset();
		mockEnsureMenuBlockAccessible.mockResolvedValue({
			name: "core/group",
			attributes: {},
		});
		globalThis.wp = {
			data: {
				dispatch: jest.fn(() => ({
					updateBlockAttributes: mockUpdateBlockAttributes,
				})),
			},
		};
	});

	test("applies a cached generated image to a placeholder without another prompt", async () => {
		appendGeneratedImageUrl("https://example.com/background.jpg", "A mountain landscape");
		const args = {
			client_id: "block-1",
			attributes: {
				style: {
					background: {
						backgroundImage: {
							url: "__IMG_1__",
						},
					},
				},
			},
		};

		const result = await handleUpdateBlockAttrs({ id: "call-1" }, args, {});

		expect(result.isError).toBe(false);
		expect(result.hasChanges).toBe(true);
		expect(mockUpdateBlockAttributes).toHaveBeenCalledWith(
			"block-1",
			expect.objectContaining({
				style: {
					background: {
						backgroundImage: {
							url: "https://example.com/background.jpg",
						},
					},
				},
			})
		);
	});
});
