/**
 * WordPress dependencies
 */
import { useDispatch, useSelect } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";
import { useCallback } from "@wordpress/element";

/**
 * Custom hook to manage editor rendering mode.
 *
 * @return {Object} Editor control functions and state.
 */
const useEditorControls = () => {
	const { setRenderingMode } = useDispatch(editorStore);

	const renderingMode = useSelect((select) => {
		const editor = select(editorStore);
		return editor?.getRenderingMode ? editor.getRenderingMode() : null;
	}, []);

	const setShowTemplate = useCallback(() => {
		if (setRenderingMode && renderingMode !== "template-locked") {
			setRenderingMode("template-locked");
			return true;
		}
		return false;
	}, [setRenderingMode, renderingMode]);

	return { setShowTemplate };
};

export default useEditorControls;
