/**
 * WordPress dependencies.
 */
import { useEffect, useState } from "@wordpress/element";
import { useDebounce } from "@wordpress/compose";
import { addQueryArgs } from "@wordpress/url";

/**
 * useDebouncedValue Hook
 *
 * Returns a debounced version of the provided value.
 * The value is updated only after the specified delay (250ms),
 * avoiding frequent updates (e.g. during fast typing).
 *
 * @param {string} value - The input value to debounce.
 * @return {string} The debounced value.
 */
export function useDebouncedValue(value: string): string {
	const [debouncedValue, setDebouncedValue] = useState("");
	const debounced = useDebounce(setDebouncedValue, 250);

	useEffect(() => {
		debounced(value);
		return () => debounced.cancel();
	}, [debounced, value]);

	return debouncedValue;
}

/**
 * Generates the edit URL for a given page ID in the WordPress editor.
 *
 * It supports both the classic Site Editor and the experimental
 * extensible Site Editor, adjusting the base URL accordingly.
 *
 * @param {number} pageId - The ID of the page to edit.
 * @return {string} The full URL to open the page in edit mode.
 */
const editPageUrl = (pageId: number): string => {
	const base = (window as any).__experimentalExtensibleSiteEditor
		? "admin.php?page=site-editor-v2"
		: "site-editor.php";

	return addQueryArgs(base, {
		p: `/page/${pageId}`,
		canvas: "edit",
		referrer: "nfd-editor-chat",
	});
};

/**
 * Loads a page inside the current editor by updating the browser history
 * and triggering a navigation event.
 *
 * This avoids a full page reload and lets the editor handle the routing.
 *
 * @param {number} pageId - The ID of the page to load.
 */
export const loadPage = (pageId: number) => {
	window.history.pushState({}, "", editPageUrl(pageId));
	window.dispatchEvent(new PopStateEvent("popstate"));
};

/**
 * Opens the specified page in a new browser tab.
 *
 *
 * @param {number} pageId - The ID of the page to open.
 */
export const openPageInNewTab = (pageId: number) => {
	window.open(editPageUrl(pageId), "_blank", "noopener,noreferrer");
};
