/**
 * WordPress dependencies.
 */
import { useRef } from "@wordpress/element";
import { useSelect } from "@wordpress/data";
import { store as coreDataStore } from "@wordpress/core-data";

/**
 * Internal dependencies.
 */
import PageSelectorProvider from "./context";
import PageSelectorInner from "./PageSelectorInner";
import { BASE_PAGE_QUERY } from "./constants";
import { ChevronUpDownIcon, DocumentTextIcon } from "../../icons";
import { DropdownMenu } from "../dropdown-menu";
import { Button } from "@wordpress/components";
import { useEditorNavigation } from "../../../../../context/editorNavigation";

export default function PageSelector() {
	const closeMenuRef = useRef<(() => void) | null>(null);
	const { currentPage } = useEditorNavigation();

	// Preload pages before opening the menu to avoid a spinner on first open.
	useSelect((select) => {
		select(coreDataStore).getEntityRecords("postType", "page", { ...BASE_PAGE_QUERY });
		return {};
	}, []);

	if (!currentPage) {
		return null;
	}

	return (
		<PageSelectorProvider closeMenuRef={closeMenuRef}>
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
