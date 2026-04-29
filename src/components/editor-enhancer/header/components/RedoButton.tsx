/**
 * WordPress dependencies.
 */
import { useDispatch, useSelect } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";

/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { RedoIcon } from "../icons";

export default function RedoButton() {
	const hasRedo = useSelect((select) => select(editorStore).hasEditorRedo(), []);
	const { redo } = useDispatch(editorStore);

	return (
		<HeaderIconButton onClick={redo} disabled={!hasRedo}>
			<RedoIcon />
		</HeaderIconButton>
	);
}
