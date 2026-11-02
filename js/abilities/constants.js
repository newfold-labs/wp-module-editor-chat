export const READ_ONLY_ABILITY_NAMES = Object.freeze([
	"blu-editor/get-editor-tree",
	"blu-editor/find-editor-blocks",
	"blu-editor/get-block-location",
	"blu-editor/get-editor-selection",
	"blu-editor/can-insert-block",
	"blu-editor/get-block-types",
	"blu-editor/get-block-type",
	"blu-editor/get-patterns",
	"blu-editor/get-pattern",
	"blu-editor/get-pattern-categories",
	"blu-editor/select-block",
]);

export const WRITE_ABILITY_NAMES = Object.freeze([
	"blu-editor/edit-block",
	"blu-editor/insert-block",
	"blu-editor/move-block",
	"blu-editor/remove-block",
	"blu-editor/update-block",
	"blu-editor/transform-block",
	"blu-editor/insert-pattern",
	"blu-editor/create-pattern",
	"blu-editor/undo",
	"blu-editor/redo",
]);

export const ABILITY_NAMES = Object.freeze([...READ_ONLY_ABILITY_NAMES, ...WRITE_ABILITY_NAMES]);
