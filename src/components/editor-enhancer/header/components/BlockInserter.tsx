/**
 * WordPress dependencies.
 */
import { useDispatch, useSelect } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";
import { useCallback } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { PlusIcon } from "../icons";

export default function BlockInserter() {
	const { setIsInserterOpened } = useDispatch(editorStore);

	const { isInserterOpened } = useSelect(
		(select) => ({
			isInserterOpened: select(editorStore).isInserterOpened(),
		}),
		[]
	);

	const toggleInserter = useCallback(
		() => setIsInserterOpened(!isInserterOpened),
		[isInserterOpened, setIsInserterOpened]
	);

	return (
		<HeaderIconButton onClick={toggleInserter}>
			<PlusIcon />
		</HeaderIconButton>
	);
}
