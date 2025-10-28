/**
 * WordPress dependencies
 */
import { useSelect } from "@wordpress/data";

/**
 * Internal dependencies
 */
import { getSelectedBlocks } from "../utils/editorHelpers";

/**
 * Custom hook to get the currently selected block(s)
 *
 * @return {Array} Array of selected block objects or empty array
 */
const useSelectedBlocks = () => {
	const selectedBlocks = useSelect(() => {
		// Use the shared utility function
		return getSelectedBlocks();
	}, []);

	return selectedBlocks;
};

export default useSelectedBlocks;
