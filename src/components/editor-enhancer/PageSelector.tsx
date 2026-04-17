/**
 * WordPress dependencies.
 */
import { DropdownMenu, MenuGroup, MenuItem } from "@wordpress/components";
import { useSelect } from "@wordpress/data";
import { store as coreDataStore } from "@wordpress/core-data";
import { store as editorDataStore } from "@wordpress/editor";
import { addQueryArgs } from "@wordpress/url";
import { page as pageIcon, check as checkIcon } from "@wordpress/icons";
import { __ } from "@wordpress/i18n";

const editPageUrl = (pageId: number) => {
	const base = (window as any).__experimentalExtensibleSiteEditor
		? "admin.php?page=site-editor-v2"
		: "site-editor.php";

	return addQueryArgs(base, {
		p: `/page/${pageId}`,
		canvas: "edit",
		referrer: "nfd-editor-chat",
	});
};

export default function PageSelector() {
	const { pages, currentPage } = useSelect(
		(select) => ({
			pages: select(coreDataStore).getEntityRecords("postType", "page", {
				per_page: -1,
			}) as any[],
			currentPage: select(editorDataStore).getCurrentPost() as any,
		}),
		[]
	);

	if (!currentPage) {
		return null;
	}

	return (
		<DropdownMenu
			className="nfd-editor-chat-header-page-selector"
			icon={pageIcon}
			text={currentPage.title}
			label={__("Navigate site pages", "wp-module-editor-chat")}
			popoverProps={{ placement: "bottom" }}
		>
			{({ onClose }) => (
				<>
					<MenuGroup>
						{pages.map((page) => {
							const isSelected = currentPage.id === page.id;
							const goToPage = () => {
								if (isSelected) {
									onClose();
									return;
								}
								document.location = editPageUrl(page.id);
							};

							return (
								<MenuItem
									key={page.id}
									onClick={goToPage}
									isSelected={isSelected}
									icon={isSelected ? checkIcon : undefined}
								>
									{page.title.rendered}
								</MenuItem>
							);
						})}
					</MenuGroup>
				</>
			)}
		</DropdownMenu>
	);
}
