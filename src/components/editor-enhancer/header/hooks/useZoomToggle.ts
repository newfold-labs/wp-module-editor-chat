/**
 * Internal dependencies.
 */
import useButtonReplacement from "./useButtonReplacement";

type UseZoomToggleReturn = ReturnType<typeof useButtonReplacement> & {
	resetZoomLevel: () => void;
};

const useZoomToggle = (): UseZoomToggleReturn => {
	// Workaround: use useButtonReplacement as the Gutenberg API for the zoom toggle is private.
	const data = useButtonReplacement({
		selector:
			".interface-interface-skeleton__header .editor-header__settings .editor-zoom-out-toggle",
		activeClass: "is-pressed",
		ancestorSelector: "#site-editor",
	});

	const { active, toggle } = data;

	const resetZoomLevel = () => {
		if (active) {
			toggle();
		}
	};

	return { ...data, resetZoomLevel };
};

export default useZoomToggle;
