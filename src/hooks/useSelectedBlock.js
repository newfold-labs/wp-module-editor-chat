/**
 * WordPress dependencies
 */
import { useSelect } from "@wordpress/data";

/**
 * Internal dependencies
 */
import { getSelectedBlocks } from "../utils/editorHelpers";

/**
 * Custom hook to get the currently selected block(s).
 *
 * Handles both single and multi-selection (shift+click).
 *
 * @return {Array} Array of selected block objects (may be empty)
 */
const useSelectedBlock = () => {
	const selectedBlocks = useSelect(() => {
		return getSelectedBlocks();
	}, []);

	return selectedBlocks;
};

export default useSelectedBlock;
