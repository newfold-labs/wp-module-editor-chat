/**
 * WordPress dependencies.
 */
import { useDispatch, useSelect } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { UndoIcon } from "../icons";

export default function UndoButton() {
	const hasUndo = useSelect((select) => select(editorStore).hasEditorUndo(), []);
	const { undo } = useDispatch(editorStore);

	return (
		<HeaderIconButton
			onClick={undo}
			disabled={!hasUndo}
			id="nfd-editor-chat__header__undo"
			label={__("Undo", "wp-module-editor-chat")}
			showTooltip
		>
			<UndoIcon />
		</HeaderIconButton>
	);
}
