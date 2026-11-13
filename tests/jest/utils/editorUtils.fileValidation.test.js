/* global describe, expect, test */

import { validateFiles } from "../../../src/utils/editorUtils";

const acceptedTypes = {
	images: ["image/png"],
	documents: ["application/pdf"],
};

function file(name, type, size) {
	return { name, type, size };
}

describe("validateFiles rejection details", () => {
	test("includes the applicable size limit for oversized files", () => {
		const image = file("large.png", "image/png", 10 * 1024 * 1024 + 1);
		const document = file("large.pdf", "application/pdf", 5 * 1024 * 1024 + 1);

		expect(validateFiles([image, document], acceptedTypes, 5).rejected).toEqual([
			{ file: image, reason: "size", limitMB: 10 },
			{ file: document, reason: "size", limitMB: 5 },
		]);
	});

	test("keeps unsupported type and attachment limit rejections distinguishable", () => {
		const archive = file("archive.zip", "application/zip", 100);
		const first = file("first.png", "image/png", 100);
		const extra = file("extra.png", "image/png", 100);

		expect(validateFiles([archive, first, extra], acceptedTypes, 1).rejected).toEqual([
			{ file: archive, reason: "type" },
			{ file: extra, reason: "limit" },
		]);
	});
});
