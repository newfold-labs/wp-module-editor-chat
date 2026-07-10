/**
 * Page selector context — thin wrapper over shared editor navigation.
 */
import { createContext, useContext } from "@wordpress/element";

/**
 * External dependencies.
 */
import type { ReactNode, MutableRefObject, MouseEvent } from "react";

/**
 * Internal dependencies.
 */
import { useEditorNavigation } from "../../../../../context/editorNavigation";

type PageSelectorProviderProps = {
	closeMenuRef: MutableRefObject<(() => void) | null>;
	children: ReactNode;
};

type ContextValue = {
	closeMenu: () => void;
	currentPage: { id: number; title?: string } | null;
	navigate: (pageId: number, event?: MouseEvent) => void;
};

const Context = createContext<ContextValue>({} as ContextValue);

export const usePageSelector = () => useContext(Context);

export default function PageSelectorProvider({
	closeMenuRef,
	children,
}: PageSelectorProviderProps) {
	const { currentPage, navigate: sharedNavigate } = useEditorNavigation();

	const closeMenu = () => closeMenuRef.current?.();

	const navigate: ContextValue["navigate"] = (pageId, event) => {
		sharedNavigate(pageId, event, closeMenu);
	};

	const theContext: ContextValue = {
		closeMenu,
		currentPage,
		navigate,
	};

	return <Context.Provider value={theContext}>{children}</Context.Provider>;
}
