/**
 * WordPress dependencies.
 */
import { useState } from "@wordpress/element";
import { useSelect } from "@wordpress/data";
import { store as coreDataStore } from "@wordpress/core-data";
import { Icon, MenuGroup, MenuItem, Spinner } from "@wordpress/components";
import { __ } from "@wordpress/i18n";
import { check as checkIcon, search as searchIcon } from "@wordpress/icons";

/**
 * Internal dependencies.
 */
import { useDebouncedValue } from "./utils";
import { BASE_PAGE_QUERY, HAS_LARGE_PAGE_COUNT } from "./constants";
import { usePageSelector } from "./context";

export default function PageSelectorInner() {
	const [term, setTerm] = useState<string | undefined>(undefined);
	const delayedSearch = useDebouncedValue(term);
	const { currentPage, navigate } = usePageSelector();

	const { pages, isLoading } = useSelect(
		(select) => {
			const query = { ...BASE_PAGE_QUERY } as any;

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
			};
		},
		[delayedSearch]
	);

	return (
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
							const handleClick = (event: React.MouseEvent) => navigate(page.id, event);

							return (
								<MenuItem
									key={page.id}
									onClick={(event: React.MouseEvent) => handleClick(event)}
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
	);
}
