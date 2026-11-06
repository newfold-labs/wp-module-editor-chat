/**
 * Return the native or polyfilled WebMCP context.
 *
 * @return {Object|null} Model context when available.
 */
export function getModelContext() {
	if (typeof document === "undefined") {
		return null;
	}
	return document.modelContext || null;
}

/**
 * Whether imperative WebMCP registration is available.
 *
 * @return {boolean} Support status.
 */
export function isWebMCPSupported() {
	return typeof getModelContext()?.registerTool === "function";
}
