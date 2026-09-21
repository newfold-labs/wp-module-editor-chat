/* global beforeEach, describe, expect, test */

import {
	appendGeneratedImageUrl,
	getImplicitLocalImagePrompts,
	resetGeneratedImageCache,
	resolveLatestGeneratedImagePlaceholders,
	unresolvedPlaceholderResult,
} from "../imageCache";

describe("generated image placeholder reuse", () => {
	beforeEach(() => {
		resetGeneratedImageCache();
	});

	test("resolves nested placeholders with the latest generated image", () => {
		appendGeneratedImageUrl("https://example.com/background.jpg", "A mountain landscape");

		expect(
			resolveLatestGeneratedImagePlaceholders({
				style: {
					background: {
						backgroundImage: {
							url: "__IMG_1__",
							source: "file",
						},
					},
				},
			})
		).toEqual({
			value: {
				style: {
					background: {
						backgroundImage: {
							url: "https://example.com/background.jpg",
							source: "file",
						},
					},
				},
			},
			image: {
				url: "https://example.com/background.jpg",
				alt: "A mountain landscape",
			},
		});
	});

	test("returns null when this turn has no generated image", () => {
		expect(resolveLatestGeneratedImagePlaceholders({ url: "__IMG_1__" })).toBeNull();
	});

	test("names the local camelCase prompt field in repair instructions", () => {
		const result = unresolvedPlaceholderResult(
			"call-1",
			'<img src="__IMG_1__">',
			{ attempted: false, generated: 0 },
			{ promptField: "imagePrompts" }
		);

		expect(result.result[0].text).toContain("imagePrompts");
		expect(result.result[0].text).not.toContain("image_prompts");
	});

	test("derives a single missing local image prompt from the user request", () => {
		expect(
			getImplicitLocalImagePrompts(
				"editor_edit-block",
				'<img src="__IMG_1__">',
				{},
				"Generate a calm yoga background and replace the current image."
			)
		).toEqual([
			{
				prompt: "Generate a calm yoga background and replace the current image.",
			},
		]);
	});
});
