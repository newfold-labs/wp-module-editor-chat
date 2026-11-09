/* global describe, expect, test */

import { EDITOR_TOOLS, LOCAL_WRITE_TOOLS, READ_ONLY_TOOLS } from "../constants";

const LOCAL_READ_TOOLS = [
	"blu-editor_get-editor-tree",
	"blu-editor_find-editor-blocks",
	"blu-editor_get-block-location",
	"blu-editor_get-editor-selection",
	"blu-editor_can-insert-block",
	"blu-editor_get-block-types",
	"blu-editor_get-block-type",
	"blu-editor_get-patterns",
	"blu-editor_get-pattern",
	"blu-editor_get-pattern-categories",
	"blu-editor_select-block",
];

const EXPECTED_LOCAL_WRITE_TOOLS = [
	"blu-editor_edit-block",
	"blu-editor_insert-block",
	"blu-editor_move-block",
	"blu-editor_remove-block",
	"blu-editor_update-block",
	"blu-editor_transform-block",
	"blu-editor_insert-pattern",
	"blu-editor_create-pattern",
	"blu-editor_undo",
	"blu-editor_redo",
];

const ALL_LOCAL_TOOLS = [...LOCAL_READ_TOOLS, ...EXPECTED_LOCAL_WRITE_TOOLS];

describe("local editor tool classifications", () => {
	test("exposes all 21 local abilities as editor tools", () => {
		expect(ALL_LOCAL_TOOLS).toHaveLength(21);
		expect(ALL_LOCAL_TOOLS.every((name) => EDITOR_TOOLS.has(name))).toBe(true);
	});

	test("classifies exactly the 11 non-document-mutating local abilities as read-only", () => {
		const classifiedLocalReads = [...READ_ONLY_TOOLS].filter((name) =>
			name.startsWith("blu-editor_")
		);

		expect(classifiedLocalReads).toEqual(LOCAL_READ_TOOLS);
	});

	test("classifies exactly the remaining 10 known local abilities as writes", () => {
		expect([...LOCAL_WRITE_TOOLS]).toEqual(EXPECTED_LOCAL_WRITE_TOOLS);
		expect(ALL_LOCAL_TOOLS.filter((name) => !READ_ONLY_TOOLS.has(name))).toEqual(
			EXPECTED_LOCAL_WRITE_TOOLS
		);
		expect(LOCAL_WRITE_TOOLS.has("blu-editor_unknown-tool")).toBe(false);
	});
});
