/**
 * Minimal hook renderer for Jest (jsdom environment). Test-only helper; not a
 * test file itself.
 */
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");

/**
 * Let pending promise callbacks settle.
 */
export async function flushAsync() {
	for (let i = 0; i < 6; i++) {
		await Promise.resolve();
	}
}

/**
 * Render a hook inside a throwaway component.
 *
 * @param {Function} useHook      Hook under test; receives the current props.
 * @param {Object}   initialProps Props for the first render.
 * @return {{result: {current: *}, rerender: Function, unmount: Function}} Handle.
 */
export async function renderHook(useHook, initialProps = {}) {
	global.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(document.createElement("div"));
	const result = { current: undefined };

	function Harness(props) {
		result.current = useHook(props);
		return null;
	}

	await act(async () => {
		root.render(React.createElement(Harness, initialProps));
		await flushAsync();
	});

	return {
		result,
		rerender: async (props) => {
			await act(async () => {
				root.render(React.createElement(Harness, props));
				await flushAsync();
			});
		},
		unmount: async () => {
			await act(async () => root.unmount());
		},
	};
}

export { act };
