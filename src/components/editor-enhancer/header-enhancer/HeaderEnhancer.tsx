/**
 * React dependencies
 */
import { createPortal } from "react-dom";

/**
 * WordPress dependencies
 */
import { useRef, useEffect, useState } from "@wordpress/element";
import PageSelector from "../PageSelector";

/**
 * Editor header enhancer
 * @constructor
 */
export default function HeaderEnhancer() {
	const [headerCenter, setHeaderCenter] = useState<HTMLDivElement>(null);
	const interval = useRef<ReturnType<typeof setInterval>>(null);

	useEffect(() => {
		const discover = () => {
			const element: HTMLDivElement = document?.querySelector(".editor-header__center");

			if (element) {
				clearDiscovering();
				setHeaderCenter(element);
			}
		};

		const clearDiscovering = () => interval.current && clearInterval(interval.current);

		interval.current = setInterval(discover, 100);

		return clearDiscovering;
	}, []);

	if (headerCenter === null) {
		return null;
	}

	return createPortal(<PageSelector />, headerCenter);
}
