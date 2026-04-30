/**
 * WordPress dependencies.
 */
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";

type UseButtonReplacementProps = {
	selector: string;
	activeClass: string;
	ancestorSelector: string;
};

type UseButtonReplacementReturn = {
	active: boolean;
	exists: boolean;
	toggle: () => void;
};

const useButtonReplacement = ({
	selector,
	activeClass,
	ancestorSelector,
}: UseButtonReplacementProps): UseButtonReplacementReturn => {
	const [active, setActive] = useState(false);
	const [original, setOriginal] = useState<HTMLButtonElement | null>(null);
	const originalRef = useRef<HTMLButtonElement | null>(null);
	const discoverIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const ancestorObserverRef = useRef<MutationObserver | null>(null);
	const classObserverRef = useRef<MutationObserver | null>(null);

	const updateOriginal = useCallback((element: HTMLButtonElement | null) => {
		if (originalRef.current === element) {
			return;
		}
		originalRef.current = element;
		setOriginal(element);
	}, []);

	const updateActive = useCallback(() => {
		const element = originalRef.current;
		setActive(Boolean(element?.classList.contains(activeClass)));
	}, [activeClass]);

	const discover = useCallback(() => {
		const element = document.querySelector<HTMLButtonElement>(selector);
		updateOriginal(element);
		return !!element;
	}, [selector, updateOriginal]);

	const toggle = useCallback(() => {
		originalRef.current?.click();
	}, []);

	useEffect(() => {
		const discoverAndClean = () => {
			if (discover()) {
				if (discoverIntervalRef.current) {
					clearInterval(discoverIntervalRef.current);
					discoverIntervalRef.current = null;
				}
			}
		};

		const startDiscovering = () => {
			console.log("startDiscovering");
			if (!discoverIntervalRef.current) {
				console.log("start")
				discoverIntervalRef.current = setInterval(discoverAndClean, 100);
				discoverAndClean();
			}
		}

		startDiscovering();

		const ancestor = document.querySelector(ancestorSelector);
		if (ancestor) {
			ancestorObserverRef.current = new MutationObserver(() => {
				startDiscovering();
			});
			ancestorObserverRef.current.observe(ancestor, {
				childList: true,
				subtree: true,
			});
		}
		return () => {
			if (discoverIntervalRef.current) {
				clearInterval(discoverIntervalRef.current);
				discoverIntervalRef.current = null;
			}
			ancestorObserverRef.current?.disconnect();
			ancestorObserverRef.current = null;
		};
	}, [ancestorSelector, discover]);

	useEffect(() => {
		classObserverRef.current?.disconnect();
		classObserverRef.current = null;
		if (!original) {
			setActive(false);
			return;
		}
		updateActive();
		classObserverRef.current = new MutationObserver(() => {
			updateActive();
		});
		classObserverRef.current.observe(original, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => {
			classObserverRef.current?.disconnect();
			classObserverRef.current = null;
		};
	}, [original, updateActive]);

	return {
		active,
		exists: !!original,
		toggle,
	};
};

export default useButtonReplacement;
