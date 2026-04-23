/**
 * WordPress dependencies.
 */
import { DropdownMenu } from "@wordpress/components";
import { useSelect } from "@wordpress/data";
import { store as editorDataStore } from "@wordpress/editor";
import { page as pageIcon } from "@wordpress/icons";
import { __ } from "@wordpress/i18n";
import { useRef } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import PageSelectorProvider from "./context";
import PageSelectorInner from "./PageSelectorInner";
import PageSelectorLeavingConfirm from "./PageSelectorLeavingConfirm";

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
				className="nfd-editor-chat-header-page-selector"
				icon={pageIcon}
				text={currentPage.title}
				label={__("Navigate site pages", "wp-module-editor-chat")}
				popoverProps={{ placement: "bottom" }}
				menuProps={{ className: "nfd-editor-chat-header-page-selector__menu" }}
			>
				{({ onClose }) => {
					closeMenuRef.current = onClose;
					return <PageSelectorInner />;
				}}
			</DropdownMenu>
		</PageSelectorProvider>
	);
}
