/**
 * WordPress dependencies.
 */
import { useSelect } from "@wordpress/data";
import { store as editorDataStore } from "@wordpress/editor";
import { useRef } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import PageSelectorProvider from "./context";
import PageSelectorInner from "./PageSelectorInner";
import PageSelectorLeavingConfirm from "./PageSelectorLeavingConfirm";
import { ChevronUpDownIcon, DocumentTextIcon } from "../../icons";
import { DropdownMenu } from "../dropdown-menu";
import { Button } from "@wordpress/components";

export default function PageSelector() {
	const closeMenuRef = useRef<(() => void) | null>(null);
	const { currentPage, isDirty } = useSelect(
		(select) => ({
			currentPage: select(editorDataStore).getCurrentPost() as any,
			isDirty: select(editorDataStore).isEditedPostDirty(),
		}),

		[]
	);

	if (!currentPage) {
		return null;
	}

	return (
		<PageSelectorProvider isDirty={isDirty} currentPage={currentPage} closeMenuRef={closeMenuRef}>
			<PageSelectorLeavingConfirm />
			<DropdownMenu
				className="nfd-editor-chat__page-selector"
				contentClassName="nfd-editor-chat__page-selector__dropdown"
				popoverProps={{ placement: "bottom" }}
				renderToggle={({ isOpen, onToggle }) => (
					<Button onClick={onToggle} aria-expanded={isOpen}>
						<DocumentTextIcon className="nfd-editor-chat__page-selector__icon" />
						<span className="nfd-editor-chat__page-selector__content">{currentPage.title}</span>
						<ChevronUpDownIcon className="nfd-editor-chat__page-selector__chevron" />
					</Button>
				)}
				renderContent={({ onClose }) => {
					closeMenuRef.current = onClose;
					return <PageSelectorInner />;
				}}
			/>
		</PageSelectorProvider>
	);
}
