/**
 * WordPress dependencies.
 */
import { createContext, useContext, useState } from "@wordpress/element";
import { useSelect } from "@wordpress/data";
import { store as coreDataStore } from "@wordpress/core-data";

/**
 * Internal dependencies.
 */
import { loadPage, openPageInNewTab } from "./utils";
import { BASE_PAGE_QUERY } from "./constants";

type PageSelectorProviderProps = {
	closeMenuRef: React.MutableRefObject<(() => void) | null>;
	currentPage?: any;
	isDirty: boolean;
	children: React.ReactNode;
};

type ContextValue = Omit<PageSelectorProviderProps, "children" | "closeMenuRef"> & {
	closeMenu: () => void;
	handleNavigationConfirm: () => void;
	handleNavigationCancel: () => void;
	navigatingToPage?: number;
	setNavigatingToPage: React.Dispatch<React.SetStateAction<number | undefined>>;
	navigate: (pageId: number, event?: React.MouseEvent) => void;
};

const Context = createContext<ContextValue>({} as ContextValue);

export const usePageSelector = () => useContext(Context);

export default function PageSelectorProvider({
	closeMenuRef,
	children,
	...passedProps
}: PageSelectorProviderProps) {
	const { currentPage, isDirty } = passedProps;
	const [navigatingToPage, setNavigatingToPage] = useState<number | undefined>();

	const closeMenu = () => closeMenuRef.current?.();

	// Preloads an initial batch of pages before opening the menu to prevent a loading spinner on first open.
	useSelect((select) => {
		const preloadQuery = { ...BASE_PAGE_QUERY };
		select(coreDataStore).getEntityRecords("postType", "page", preloadQuery);
		return {};
	}, []);

	const privateNavigate = (pageId: number) => {
		// Delayed to prevent the menu from remaining open while the page reloads.
		setTimeout(() => loadPage(pageId), 1);
	};

	const navigate: ContextValue["navigate"] = (pageId, event) => {
		if (event?.metaKey) {
			openPageInNewTab(pageId);
			return;
		}
		closeMenu();

		const isCurrentPage = currentPage.id === pageId;
		if (isCurrentPage) {
			return;
		}

		if (isDirty) {
			setNavigatingToPage(pageId);
		} else {
			privateNavigate(pageId);
		}
	};

	const handleNavigationConfirm = () => {
		if (navigatingToPage) privateNavigate(navigatingToPage);
		setNavigatingToPage(undefined);
	};

	const handleNavigationCancel = () => {
		setNavigatingToPage(undefined);
		closeMenu();
	};

	const theContext: ContextValue = {
		...passedProps,
		closeMenu,
		handleNavigationConfirm,
		handleNavigationCancel,
		navigatingToPage,
		setNavigatingToPage,
		navigate,
	};

	return <Context.Provider value={theContext}>{children}</Context.Provider>;
}
