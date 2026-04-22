/**
 * WordPress dependencies.
 */
import { DropdownMenu, MenuGroup, MenuItem, Spinner, Icon } from "@wordpress/components";
import { useSelect } from "@wordpress/data";
import { store as coreDataStore } from "@wordpress/core-data";
import { store as editorDataStore } from "@wordpress/editor";
import { addQueryArgs } from "@wordpress/url";
import { page as pageIcon, check as checkIcon, search as searchIcon } from "@wordpress/icons";
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "@wordpress/element";
import { useDebounce } from "@wordpress/compose";

const PAGE_COUNT_THRESHOLD = 100;
const PAGE_COUNT = (window as any)?.nfdEditorChat?.pagesCount ?? 101;
const HAS_LARGE_PAGE_COUNT = PAGE_COUNT > PAGE_COUNT_THRESHOLD;

function useDebouncedValue(value: string) {
	const [debouncedValue, setDebouncedValue] = useState("");
	const debounced = useDebounce(setDebouncedValue, 250);

	useEffect(() => {
		debounced(value);
		return () => debounced.cancel();
	}, [debounced, value]);

	return debouncedValue;
}

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
	const [term, setTerm] = useState<string | undefined>(undefined);
	const delayedSearch = useDebouncedValue(term);
	const { pages, isLoading, currentPage } = useSelect(
		(select) => {
			const query: any = {
				per_page: 100,
				orderby: "title",
				order: "asc",
			};

			if (delayedSearch) {
				query.search = delayedSearch;
				query.search_columns = ["post_title"];
			}

			return {
				pages: (select(coreDataStore).getEntityRecords("postType", "page", query) ?? []) as any[],
				isLoading: !select(coreDataStore).hasFinishedResolution("getEntityRecords", [
					"postType",
					"page",
					query,
				]),
				currentPage: select(editorDataStore).getCurrentPost() as any,
			};
		},
		[delayedSearch]
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
			menuProps={{ className: "nfd-editor-chat-header-page-selector__menu" }}
		>
			{({ onClose }) => (
				<>
					{HAS_LARGE_PAGE_COUNT && (
						<div className="nfd-editor-chat-header-page-selector__menu__header">
							<Icon icon={searchIcon} />
							<input
								className="nfd-editor-chat-header-page-selector__menu__search"
								type="text"
								value={term}
								onChange={(e) => setTerm(e.target.value)}
								placeholder={__("Search pages...", "wp-module-editor-chat")}
							/>
						</div>
					)}

					<MenuGroup>
						{isLoading && (
							<div className="nfd-editor-chat-header-page-selector__menu__spinner">
								<Spinner />
							</div>
						)}

						{!!pages.length && (
							<>
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
											icon={isSelected ? checkIcon : undefined}
										>
											{page.title.rendered}
										</MenuItem>
									);
								})}
							</>
						)}

						{!isLoading && !pages.length && (
							<div className="nfd-editor-chat-header-page-selector__menu__no-results">
								{__("No pages found...", "wp-module-editor-chat")}
							</div>
						)}
					</MenuGroup>
				</>
			)}
		</DropdownMenu>
	);
}
