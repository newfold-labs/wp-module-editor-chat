/**
 * WordPress dependencies
 */
import { useSelect } from "@wordpress/data";

/**
 * Internal dependencies
 */
import { getSelectedBlock } from "../utils/editorHelpers";

/**
 * Custom hook to get the currently selected block(s)
 *
 * @return {Array} Array of selected block objects or empty array
 */
const useSelectedBlock = () => {
	const selectedBlock = useSelect(() => {
		// Use the shared utility function
		return getSelectedBlock();
	}, []);

	return selectedBlock;
};

export default useSelectedBlock;
