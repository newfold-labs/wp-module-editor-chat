/**
 * WordPress dependencies.
 */
import { useDispatch, useSelect } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";
import { useCallback } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { QueueListIcon } from "../icons";
import HeaderIconButton from "./HeaderIconButton";

export default function DocumentOverviewToggle() {
	const { setIsListViewOpened } = useDispatch(editorStore);

	const { isOpen } = useSelect(
		(select) => ({
			isOpen: select(editorStore).isListViewOpened(),
		}),
		[]
	);

	const toggle = useCallback(() => setIsListViewOpened(!isOpen), [isOpen, setIsListViewOpened]);

	return (
		<HeaderIconButton onClick={toggle} id="nfd-editor-chat__header__document-overview-toggle">
			<QueueListIcon />
		</HeaderIconButton>
	);
}
