const LOCAL_TOOL_PATTERN = /^blu-editor_[A-Za-z0-9_.-]+$/;

const DIRECT_MCP_EQUIVALENTS = Object.freeze({
	"blu-editor_edit-block": "blu-edit-block",
	"blu-editor_move-block": "blu-move-block",
	"blu-editor_remove-block": "blu-delete-block",
	"blu-editor_update-block": "blu-update-block-attrs",
});

// Local tools the model must never see. Section/content creation (text plus
// images) belongs to the server `blu-add-section` ability, which returns a fully
// formatted block; the low-level local insert would bypass it.
const MODEL_HIDDEN_LOCAL_TOOLS = new Set(["blu-editor_insert-block"]);

const ALLOWED_FALLBACK_TOOLS = new Set(Object.values(DIRECT_MCP_EQUIVALENTS));
const EMPTY_INPUT_SCHEMA = Object.freeze({ type: "object", properties: {} });

function getModelContext() {
	if (typeof document === "undefined") {
		return null;
	}
	return document.modelContext || null;
}

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSchema(schema) {
	const parsed = typeof schema === "string" ? JSON.parse(schema) : schema;
	if (!isObject(parsed)) {
		throw new TypeError("Tool input schema must be an object.");
	}
	return parsed;
}

function normalizeTool(tool) {
	if (!isObject(tool) || !isLocalToolName(tool.name)) {
		return null;
	}

	try {
		const schema = tool.inputSchema ?? tool.serializedSchema ?? EMPTY_INPUT_SCHEMA;
		return {
			...tool,
			inputSchema: parseSchema(schema),
		};
	} catch {
		return null;
	}
}

function extractText(result) {
	if (typeof result === "string") {
		return result;
	}
	if (typeof result?.text === "string") {
		return result.text;
	}
	if (typeof result?.content === "string") {
		return result.content;
	}
	if (Array.isArray(result?.content)) {
		return result.content
			.filter((item) => item?.type === "text" && typeof item.text === "string")
			.map((item) => item.text)
			.join("\n");
	}
	return "";
}

/**
 * WebMCP's executeTool resolves with a JSON string (the WebMCP polyfill always
 * does). Without parsing it, `isError` and `structuredContent` are lost and a
 * failed tool call is reported to the model as a success.
 *
 * @param {unknown} result Raw executeTool result.
 * @return {unknown} Parsed tool result, or the original value.
 */
function parseSerializedResult(result) {
	if (typeof result !== "string") {
		return result;
	}
	try {
		const parsed = JSON.parse(result);
		if (isObject(parsed) && ("content" in parsed || "isError" in parsed)) {
			return parsed;
		}
	} catch {
		// Plain text result.
	}
	return result;
}

function errorResult(message) {
	return {
		isError: true,
		text: message,
		structuredContent: undefined,
	};
}

/**
 * Determine whether a tool belongs to the local editor WebMCP namespace.
 *
 * @param {unknown} name Candidate tool name.
 * @return {boolean} Whether the name is a local editor tool.
 */
export function isLocalToolName(name) {
	return typeof name === "string" && LOCAL_TOOL_PATTERN.test(name);
}

/**
 * List local editor tools currently exposed through WebMCP.
 *
 * @return {Promise<Array>} Normalized local tool metadata.
 */
export async function listLocalTools() {
	const modelContext = getModelContext();
	if (typeof modelContext?.getTools !== "function") {
		return [];
	}

	try {
		const tools = await modelContext.getTools();
		if (!Array.isArray(tools)) {
			return [];
		}
		return tools.map(normalizeTool).filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Execute a local editor tool through its WebMCP context.
 *
 * @param {string} name Tool name.
 * @param {Object} args Tool arguments.
 * @return {Promise<Object>} Normalized local result.
 */
export async function runLocalTool(name, args = {}) {
	const modelContext = getModelContext();
	if (
		!isLocalToolName(name) ||
		typeof modelContext?.getTools !== "function" ||
		typeof modelContext?.executeTool !== "function"
	) {
		return errorResult("Local editor tools are unavailable.");
	}

	const tools = await listLocalTools();
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) {
		return errorResult(`Local editor tool "${name}" is unavailable.`);
	}

	try {
		const result = parseSerializedResult(
			await modelContext.executeTool(tool, isObject(args) ? args : {})
		);
		return {
			isError: Boolean(result?.isError),
			text: extractText(result),
			structuredContent: result?.structuredContent,
		};
	} catch (error) {
		return errorResult(String(error?.message || error));
	}
}

/**
 * Subscribe to WebMCP tool registration changes.
 *
 * @param {() => void} callback Change listener.
 * @return {(() => void)|null} Cleanup callback, or null when unsupported.
 */
export function onLocalToolsChanged(callback) {
	const modelContext = getModelContext();
	if (
		typeof callback !== "function" ||
		typeof modelContext?.addEventListener !== "function" ||
		typeof modelContext?.removeEventListener !== "function"
	) {
		return null;
	}

	modelContext.addEventListener("toolchange", callback);
	return () => modelContext.removeEventListener("toolchange", callback);
}

/**
 * Merge local and MCP discovery while hiding only superseded direct tools.
 *
 * @param {Array} localTools Local WebMCP tools.
 * @param {Array} mcpTools   Remote MCP tools.
 * @return {Array} Merged model-facing tools.
 */
export function mergeLocalAndMcpTools(localTools, mcpTools) {
	const safeLocalTools = Array.isArray(localTools) ? localTools : [];
	const safeMcpTools = Array.isArray(mcpTools) ? mcpTools : [];
	const supersededNames = new Set(
		safeLocalTools
			.filter((tool) => isLocalToolName(tool?.name))
			.map((tool) => DIRECT_MCP_EQUIVALENTS[tool.name])
			.filter(Boolean)
	);

	return [
		...safeLocalTools.filter((tool) => !MODEL_HIDDEN_LOCAL_TOOLS.has(tool?.name)),
		...safeMcpTools.filter((tool) => !supersededNames.has(tool?.name)),
	];
}

/**
 * Read an approved legacy fallback from an error result.
 *
 * @param {Object} result Normalized local tool result.
 * @return {Object|null} Approved fallback descriptor.
 */
export function getLocalToolFallback(result) {
	const metadata = result?.structuredContent;
	if (
		result?.isError !== true ||
		!isObject(metadata) ||
		metadata.mutated !== false ||
		!ALLOWED_FALLBACK_TOOLS.has(metadata.fallbackTool) ||
		!isObject(metadata.fallbackArguments)
	) {
		return null;
	}

	return {
		name: metadata.fallbackTool,
		arguments: metadata.fallbackArguments,
	};
}
