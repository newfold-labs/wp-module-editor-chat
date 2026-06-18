/**
 * WordPress dependencies
 */
import { useSelect } from "@wordpress/data";
import { useEffect, useRef } from "@wordpress/element";
import { store as interfaceStore } from "@wordpress/interface";

// Keep in sync with $slide-duration in styles/sidebar/_main.scss.
const SLIDE_DURATION = 300;
const CLOSING_CLASS = "nfd-editor-chat-closing";

/**
 * Toggles a body class while the chat panel is closing so its slide-out
 * keyframe can play during WordPress's exit window (see styles/sidebar/_main.scss).
 *
 * @param {string} scope The complementary area scope (e.g. "core").
 * @param {string} name  The complementary area identifier.
 */
const useChatSlideAnimation = (scope, name) => {
	const isOpen = useSelect(
		(select) => select(interfaceStore).getActiveComplementaryArea(scope) === name,
		[scope, name]
	);
	const wasOpenRef = useRef(false);

	useEffect(() => {
		const { body } = document;

		if (isOpen) {
			body.classList.remove(CLOSING_CLASS);
			wasOpenRef.current = true;
			return undefined;
		}

		if (!wasOpenRef.current) {
			return undefined;
		}

		// Open -> closed: play the slide-out, then clear the flag after the exit.
		wasOpenRef.current = false;
		body.classList.add(CLOSING_CLASS);
		const timer = setTimeout(() => {
			body.classList.remove(CLOSING_CLASS);
		}, SLIDE_DURATION);

		return () => clearTimeout(timer);
	}, [isOpen]);
};

export default useChatSlideAnimation;
