/**
 * WordPress dependencies.
 */
import { useState } from "@wordpress/element";
import { useSelect } from "@wordpress/data";
import { store as coreDataStore } from "@wordpress/core-data";
import { Icon, Spinner } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies.
 */
import type { MouseEvent } from "react";

/**
 * Internal dependencies.
 */
import { useDebouncedValue } from "./utils";
import { BASE_PAGE_QUERY, HAS_LARGE_PAGE_COUNT } from "./constants";
import { usePageSelector } from "./context";
import { DropdownMenuItem, DropdownMenuSection } from "../dropdown-menu";
import { CheckIcon, MagnifyingGlassIcon } from "../../icons";

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
				<DropdownMenuSection>
					<div className="nfd-editor-chat__page-selector__dropdown__header">
						<MagnifyingGlassIcon className="nfd-editor-chat__page-selector__dropdown__search-icon" />
						<input
							className="nfd-editor-chat__page-selector__dropdown__search"
							type="text"
							value={term}
							onChange={(e) => setTerm(e.target.value)}
							placeholder={__("Search pages...", "wp-module-editor-chat")}
						/>
					</div>
				</DropdownMenuSection>
			)}

			<DropdownMenuSection>
				{isLoading && (
					<div className="nfd-editor-chat__page-selector__dropdown__spinner">
						<Spinner />
					</div>
				)}

				{!!pages.length && (
					<>
						{pages.map((page) => {
							const isSelected = currentPage.id === page.id;
							const handleClick = (event: MouseEvent) => navigate(page.id, event);

							return (
								<DropdownMenuItem
									key={page.id}
									onClick={(event: MouseEvent) => handleClick(event)}
									endDecoration={isSelected ? <CheckIcon /> : undefined}
								>
									{page.title.rendered}
								</DropdownMenuItem>
							);
						})}
					</>
				)}

				{!isLoading && !pages.length && (
					<div className="nfd-editor-chat__page-selector__dropdown__no-results">
						{__("No pages found...", "wp-module-editor-chat")}
					</div>
				)}
			</DropdownMenuSection>
		</>
	);
}
