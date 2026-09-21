/* global describe, expect, test */

import { getImageReplacementRecovery } from "../imageEditRecovery";

describe("malformed edit-block image recovery", () => {
	test("targets the only image descendant with the generated URL", () => {
		const block = {
			name: "core/group",
			clientId: "group-1",
			innerBlocks: [
				{
					name: "core/image",
					clientId: "image-1",
					innerBlocks: [],
				},
			],
		};

		expect(
			getImageReplacementRecovery(block, { generated: 1 }, [
				{ url: "https://example.com/new.jpg", alt: "Mountain peaks" },
			])
		).toEqual({
			client_id: "image-1",
			attributes: {
				url: "https://example.com/new.jpg",
				alt: "Mountain peaks",
			},
		});
	});

	test("does not guess when the subtree contains multiple image targets", () => {
		const block = {
			name: "core/group",
			clientId: "group-1",
			innerBlocks: [
				{ name: "core/image", clientId: "image-1", innerBlocks: [] },
				{ name: "core/image", clientId: "image-2", innerBlocks: [] },
			],
		};

		expect(
			getImageReplacementRecovery(block, { generated: 1 }, [
				{ url: "https://example.com/new.jpg", alt: "" },
			])
		).toBeNull();
	});
});
