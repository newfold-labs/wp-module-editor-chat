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

	const maxAttempts = 5;
	const retryDelay = 500;

	const findAndClick = (attempt = 0) => {
		const button = document.querySelector(zoomButtonSelectors.join(", "));
		if (button) {
			const isPressed = button.getAttribute("aria-pressed");
			// If zoom out is already active, do not toggle it off.
			if (isPressed === "true") {
				return true;
			}

			button.click();
			return true;
		}

		if (attempt < maxAttempts) {
			setTimeout(() => {
				findAndClick(attempt + 1);
			}, retryDelay);
		} else {
			// eslint-disable-next-line no-console
			console.warn("enableZoomOut: zoom out button not found after maximum retries.");
		}

		return false;
	};

	findAndClick(0);
};
