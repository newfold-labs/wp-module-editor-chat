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
import { getEditUrl, loadEditorEntity, openPageInNewTab } from "../services/contentNavigation";

type NavigationOutcome = {
	navigated: boolean;
	editUrl: string;
	cancelled?: boolean;
};

type NavigationOptions = {
	/** Full page load instead of Site Editor SPA routing (e.g. after creating new content). */
	fullPageLoad?: boolean;
};

type PendingNavigation = {
	postType: string;
	entityId: number;
	editUrl: string;
	fullPageLoad: boolean;
	resolve: (outcome: NavigationOutcome) => void;
};

type EditorNavigationContextValue = {
	currentPage: { id: number; title?: string } | null;
	isDirty: boolean;
	/** Navigate to a page (header page selector). */
	navigate: (pageId: number, event?: MouseEvent, onBeforeNavigate?: () => void) => void;
	/** Navigate to a page or post from chat after creation — returns when done or user stays. */
	requestNavigateToContent: (
		postType: string,
		entityId: number,
		options?: NavigationOptions
	) => Promise<NavigationOutcome>;
	requestNavigateToPage: (pageId: number) => Promise<NavigationOutcome>;
};

const noopNavigate = async () => ({ navigated: false, editUrl: "" });

const Context = createContext<EditorNavigationContextValue>({
	currentPage: null,
	isDirty: false,
	navigate: () => {},
	requestNavigateToContent: noopNavigate,
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

	const performNavigate = useCallback(
		(postType: string, entityId: number, options: NavigationOptions = {}) => {
			setTimeout(() => loadEditorEntity(postType, entityId, options), 1);
		},
		[]
	);

	const requestNavigateToContent = useCallback(
		(
			postType: string,
			entityId: number,
			options: NavigationOptions = {}
		): Promise<NavigationOutcome> => {
			const editUrl = getEditUrl(postType, entityId);
			const { fullPageLoad = false } = options;

			if (!fullPageLoad && postType === "page" && currentPage?.id === entityId) {
				return Promise.resolve({ navigated: true, editUrl });
			}

			if (!isDirty) {
				performNavigate(postType, entityId, options);
				return Promise.resolve({ navigated: true, editUrl });
			}
			return new Promise((resolve) => {
				const pending: PendingNavigation = {
					postType,
					entityId,
					editUrl,
					fullPageLoad,
					resolve,
				};
				pendingNavRef.current = pending;
				setPendingNav(pending);
			});
		},
		[currentPage?.id, isDirty, performNavigate]
	);

	const requestNavigateToPage = useCallback(
		(pageId: number) => requestNavigateToContent("page", pageId),
		[requestNavigateToContent]
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
				performNavigate("page", pageId);
				return;
			}

			const editUrl = getEditUrl("page", pageId);
			const pending: PendingNavigation = {
				postType: "page",
				entityId: pageId,
				editUrl,
				fullPageLoad: false,
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
		performNavigate(pending.postType, pending.entityId, {
			fullPageLoad: pending.fullPageLoad,
		});
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
			requestNavigateToContent,
			requestNavigateToPage,
		}),
		[currentPage, isDirty, navigate, requestNavigateToContent, requestNavigateToPage]
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
