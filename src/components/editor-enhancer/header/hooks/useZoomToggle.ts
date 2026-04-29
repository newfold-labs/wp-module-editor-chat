/**
 * Internal dependencies.
 */
import useButtonReplacement from "./useButtonReplacement";

type UseZoomToggleReturn = ReturnType<typeof useButtonReplacement> & {
	resetZoomLevel: () => void;
};

const useZoomToggle = (): UseZoomToggleReturn => {
	// Workaround: use useButtonReplacement as the Gutenberg API for the zoom toggle is private.
	const { active, toggle } = useButtonReplacement({
		selector: ".editor-header__settings .editor-zoom-out-toggle",
		activeClass: "is-pressed",
		ancestorSelector: ".interface-interface-skeleton__header",
	});

	const resetZoomLevel = () => {
		if (active) {
			toggle();
		}
	};

	return { active, toggle, resetZoomLevel };
};

export default useZoomToggle;
