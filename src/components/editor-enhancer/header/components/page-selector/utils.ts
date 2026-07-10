/**
 * WordPress dependencies.
 */
import { useEffect, useState } from "@wordpress/element";
import { useDebounce } from "@wordpress/compose";

/**
 * Internal dependencies.
 */
export { loadPage, openPageInNewTab, getEditUrl } from "../../../../../services/contentNavigation";

/**
 * useDebouncedValue Hook
 *
 * Returns a debounced version of the provided value.
 * The value is updated only after the specified delay (250ms),
 * avoiding frequent updates (e.g. during fast typing).
 *
 * @param {string | undefined} value - The input value to debounce.
 * @return {string} The debounced value.
 */
export function useDebouncedValue(value: string | undefined): string {
	const [debouncedValue, setDebouncedValue] = useState("");
	const debounced = useDebounce(setDebouncedValue, 250);

	useEffect(() => {
		debounced(value ?? "");
		return () => debounced.cancel();
	}, [debounced, value]);

	return debouncedValue;
}
