/**
 * Local tool registry (webpack world).
 *
 * Reads whatever js/abilities/ (a separate, hand-written script-module
 * layer — see that directory) registered on document.modelContext (WebMCP).
 * This file cannot share an in-memory registry with js/abilities/webmcp-bridge.js
 * directly: that file runs as a WordPress script module, this one is bundled
 * by webpack into the chat entry, and the two are separate module graphs
 * with no shared import-map specifier between them. document.modelContext is
 * the one surface both sides can reach, so every local tool call goes
 * through it.
 *
 * Every tool js/abilities/ registers is named editor_<something> (see
 * js/abilities/webmcp-bridge.js toToolName()); that prefix is how this file
 * tells a local editor ability apart from any other WebMCP tool a different
 * plugin might register on the same page.
 */

const LOCAL_TOOL_PREFIX = "editor_";

/**
 * Get the WebMCP context from document or navigator.
 *
 * @return {Object|null} The model context object or null if not available.
 */
function getModelContext() {
	if (typeof document !== "undefined" && document.modelContext) {
		return document.modelContext;
	}
	if (typeof navigator !== "undefined" && navigator.modelContext) {
		return navigator.modelContext;
	}
	return null;
}

/**
 * Parse JSON string or return value as-is if not a string or parsing fails.
 *
 * @param {*} value The value to parse.
 * @return {*} Parsed JSON or the original value if parsing fails.
 */
function parseMaybeJson(value) {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/**
 * Whether a tool name belongs to the local editor-abilities layer.
 *
 * @param {string} name The tool name to check.
 * @return {boolean} True if the tool is a local editor tool.
 */
export function isLocalToolName(name) {
	return typeof name === "string" && name.startsWith(LOCAL_TOOL_PREFIX);
}

/**
 * Local (editor_*) WebMCP tools currently registered on this page, or an
 * empty array when the client-side Abilities API never registered (older
 * WordPress, or nfd_editor_chat_local_abilities_enabled returned false).
 *
 * @return {Promise<Array<{name: string, description: string, inputSchema: Object}>>} Local tools list.
 */
export async function listLocalTools() {
	const modelContext = getModelContext();
	if (typeof modelContext?.getTools !== "function") {
		return [];
	}

	try {
		const tools = await modelContext.getTools();
		return (tools || []).filter((tool) => isLocalToolName(tool?.name));
	} catch (error) {
		console.warn("[nfd-editor-chat] Could not list local editor tools:", error);
		return [];
	}
}

/**
 * Run a local editor ability by tool name.
 *
 * Tool failures are returned, not thrown — a failed call is something the
 * model should see and be able to correct, same convention as every other
 * tool result in toolDispatcher.js.
 *
 * @param {string} name Tool name, e.g. "editor_get-editor-tree".
 * @param {Object} args Arguments for the tool.
 * @return {Promise<{isError: boolean, text: string}>} Tool execution result.
 */
export async function runLocalTool(name, args = {}) {
	const modelContext = getModelContext();
	if (
		typeof modelContext?.executeTool !== "function" ||
		typeof modelContext?.getTools !== "function"
	) {
		return {
			isError: true,
			text: JSON.stringify({ error: `Local editor tool "${name}" is unavailable on this page.` }),
		};
	}

	try {
		const tools = await modelContext.getTools();
		const tool = (tools || []).find((t) => t?.name === name);
		if (!tool) {
			return {
				isError: true,
				text: JSON.stringify({ error: `Unknown local editor tool: ${name}` }),
			};
		}

		const raw = await modelContext.executeTool(tool, JSON.stringify(args ?? {}));
		const parsed = parseMaybeJson(raw);
		const isError = !!parsed?.isError;
		const content = Array.isArray(parsed?.content) ? parsed.content : [];
		const text = content
			.filter((block) => block?.type === "text")
			.map((block) => block.text)
			.join("\n");

		return { isError, text: text || JSON.stringify(parsed) };
	} catch (error) {
		return { isError: true, text: JSON.stringify({ error: String(error?.message || error) }) };
	}
}

/**
 * Merge local editor abilities with the MCP tool list for this session,
 * ready for mcpToolsToOpenAI(). No MCP ability is ever removed server-side —
 * only kept out of *this request's* tool list, and only when explicitly
 * declared superseded, so the model is steered onto the fast path without
 * ever losing the MCP fallback on a session where the local one is absent.
 *
 * @param {Array<Object>} localTools           From listLocalTools().
 * @param {Array<Object>} mcpTools             From mcpClient.listTools().
 * @param {string[]}      [supersededMcpNames] MCP tool names to omit this
 *                                             session because a local ability
 *                                             already covers the same
 *                                             operation. Empty until a
 *                                             specific editor/* ability is
 *                                             confirmed to replace a named
 *                                             MCP ability (see
 *                                             docs/local-abilities.md).
 * @return {Array<Object>} Merged list of local and MCP tools.
 */
export function mergeLocalAndMcpTools(localTools, mcpTools, supersededMcpNames = []) {
	const superseded = new Set(supersededMcpNames);
	const filteredMcpTools = (mcpTools || []).filter((tool) => !superseded.has(tool?.name));
	return [...(localTools || []), ...filteredMcpTools];
}
