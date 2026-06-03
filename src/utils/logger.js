/**
 * Logger with dev-only verbose output and a runtime debug switch.
 *
 * `log`/`info`/`debug` are emitted only when verbose logging is enabled:
 *   - automatically in development builds (process.env.NODE_ENV !== "production"), or
 *   - on demand in ANY build by setting the runtime flag and reloading:
 *       localStorage.setItem("nfd-editor-chat-debug", "1")   // disable: remove or set "0"
 *
 * This keeps the console clean for end users by default while letting developers
 * turn the full trace back on in production without a separate dev build.
 *
 * `warn`/`error` always pass through so genuine problems stay visible.
 */

const DEBUG_FLAG = "nfd-editor-chat-debug";
const isDev = process.env.NODE_ENV !== "production";

/**
 * Whether verbose logging is currently enabled.
 * Read at call time so the flag can be toggled in the console (takes effect on
 * the next log; no reload strictly required).
 *
 * @return {boolean} True when log/info/debug should emit.
 */
function debugEnabled() {
	if (isDev) {
		return true;
	}
	try {
		return window.localStorage?.getItem(DEBUG_FLAG) === "1";
	} catch {
		return false;
	}
}

/* eslint-disable no-console */
const logger = {
	log: (...args) => debugEnabled() && console.log(...args),
	info: (...args) => debugEnabled() && console.info(...args),
	debug: (...args) => debugEnabled() && console.debug(...args),
	warn: (...args) => console.warn(...args),
	error: (...args) => console.error(...args),
};
/* eslint-enable no-console */

export default logger;
