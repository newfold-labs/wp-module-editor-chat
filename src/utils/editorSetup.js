/**
 * Enable zoom out by clicking the zoom out button in the editor toolbar.
 */
export const enableZoomOut = () => {
	const zoomButtonSelectors = [
		'button[aria-label="Zoom out"]',
		'button[aria-label="Zoom Out"]',
		".block-editor-zoom-out-button",
		".edit-site-visual-editor__zoom-dropdown button",
	];

	const findAndClick = () => {
		const button = document.querySelector(zoomButtonSelectors.join(", "));
		if (button) {
			button.click();
			return true;
		}
		return false;
	};

	if (!findAndClick()) {
		setTimeout(findAndClick, 1500);
	}
};
