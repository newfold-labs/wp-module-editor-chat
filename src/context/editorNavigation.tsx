/**
 * Shared editor navigation — page switching from the header or chat after content creation.
 * Reuses the unsaved-changes confirmation dialog for all navigation sources.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "@wordpress/element";
import { useSelect } from "@wordpress/data";
import { store as editorDataStore } from "@wordpress/editor";
import { __experimentalConfirmDialog as ConfirmDialog } from "@wordpress/components";
import { _x, __ } from "@wordpress/i18n";

/**
 * External dependencies.
 */
import type { ReactNode, MouseEvent } from "react";

/**
 * Internal dependencies.
 */
import { getEditUrl, loadPage, openPageInNewTab } from "../services/contentNavigation";

type NavigationOutcome = {
	navigated: boolean;
	editUrl: string;
	cancelled?: boolean;
};

type PendingNavigation = {
	pageId: number;
	editUrl: string;
	resolve: (outcome: NavigationOutcome) => void;
};

type EditorNavigationContextValue = {
	currentPage: { id: number; title?: string } | null;
	isDirty: boolean;
	/** Navigate to a page (header page selector). */
	navigate: (pageId: number, event?: MouseEvent, onBeforeNavigate?: () => void) => void;
	/** Navigate to a page from chat after creation — returns when done or user stays. */
	requestNavigateToPage: (pageId: number) => Promise<NavigationOutcome>;
};

const noopNavigate = async () => ({ navigated: false, editUrl: "" });

const Context = createContext<EditorNavigationContextValue>({
	currentPage: null,
	isDirty: false,
	navigate: () => {},
	requestNavigateToPage: noopNavigate,
});

export const useEditorNavigation = () => useContext(Context);

function NavigationLeavingConfirm({
	pending,
	onConfirm,
	onCancel,
}: {
	pending: PendingNavigation | null;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<ConfirmDialog
			isOpen={!!pending}
			onConfirm={onConfirm}
			onCancel={onCancel}
			cancelButtonText={_x("Stay", "Dialog action: stay on page", "wp-module-editor-chat")}
			confirmButtonText={_x(
				"Leave",
				"Dialog action: leave page with unsaved changes",
				"wp-module-editor-chat"
			)}
		>
			{__(
				"You have unsaved changes. Leaving this page will discard them.",
				"wp-module-editor-chat"
			)}
		</ConfirmDialog>
	);
}

export default function EditorNavigationProvider({ children }: { children: ReactNode }) {
	const { currentPage, isDirty } = useSelect(
		(select) => ({
			currentPage: select(editorDataStore).getCurrentPost() as { id: number; title?: string } | null,
			isDirty: select(editorDataStore).isEditedPostDirty() as boolean,
		}),
		[]
	);

	const [pendingNav, setPendingNav] = useState<PendingNavigation | null>(null);
	const pendingNavRef = useRef<PendingNavigation | null>(null);

	const performNavigate = useCallback((pageId: number) => {
		setTimeout(() => loadPage(pageId), 1);
	}, []);

	const requestNavigateToPage = useCallback(
		(pageId: number): Promise<NavigationOutcome> => {
			const editUrl = getEditUrl("page", pageId);

			if (currentPage?.id === pageId) {
				return Promise.resolve({ navigated: true, editUrl });
			}

			if (!isDirty) {
				performNavigate(pageId);
				return Promise.resolve({ navigated: true, editUrl });
			}
			return new Promise((resolve) => {
				const pending: PendingNavigation = { pageId, editUrl, resolve };
				pendingNavRef.current = pending;
				setPendingNav(pending);
			});
		},
		[currentPage?.id, isDirty, performNavigate]
	);

	const navigate = useCallback(
		(pageId: number, event?: MouseEvent, onBeforeNavigate?: () => void) => {
			if (event?.metaKey) {
				openPageInNewTab(pageId);
				return;
			}

			onBeforeNavigate?.();

			if (currentPage?.id === pageId) {
				return;
			}

			if (!isDirty) {
				performNavigate(pageId);
				return;
			}

			const editUrl = getEditUrl("page", pageId);
			const pending: PendingNavigation = {
				pageId,
				editUrl,
				resolve: () => {},
			};
			pendingNavRef.current = pending;
			setPendingNav(pending);
		},
		[currentPage?.id, isDirty, performNavigate]
	);

	const handleNavigationConfirm = useCallback(() => {
		const pending = pendingNavRef.current;
		if (!pending) {
			return;
		}
		performNavigate(pending.pageId);
		pending.resolve({ navigated: true, editUrl: pending.editUrl });
		pendingNavRef.current = null;
		setPendingNav(null);
	}, [performNavigate]);

	const handleNavigationCancel = useCallback(() => {
		const pending = pendingNavRef.current;
		if (!pending) {
			return;
		}
		pending.resolve({ navigated: false, editUrl: pending.editUrl, cancelled: true });
		pendingNavRef.current = null;
		setPendingNav(null);
	}, []);

	const value = useMemo(
		() => ({
			currentPage,
			isDirty,
			navigate,
			requestNavigateToPage,
		}),
		[currentPage, isDirty, navigate, requestNavigateToPage]
	);

	return (
		<Context.Provider value={value}>
			{children}
			<NavigationLeavingConfirm
				pending={pendingNav}
				onConfirm={handleNavigationConfirm}
				onCancel={handleNavigationCancel}
			/>
		</Context.Provider>
	);
}
