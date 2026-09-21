/**
 * Bridge WordPress client-side abilities to the WebMCP Imperative API.
 *
 * @see https://developer.chrome.com/docs/ai/webmcp
 */

import { executeAbility, getAbility } from "@wordpress/abilities";
import { getModelContext } from "@newfold-labs/editor-chat-webmcp-env";

/**
 * WebMCP tool names may include alphanumerics, _, -, and .
 * Convert ability names like "editor/get-editor-tree" -> "editor_get-editor-tree".
 *
 * @param {string} abilityName
 * @return {string} The WebMCP tool name.
 */
export function toToolName(abilityName) {
	return abilityName.replace(/\//g, "_");
}

/**
 * @param {Object} [ability]
 * @return {{ readOnlyHint: boolean }|undefined} The WebMCP tool annotations, or undefined when the ability has none.
 */
function toToolAnnotations(ability) {
	const annotations = ability?.meta?.annotations;
	if (!annotations) {
		return undefined;
	}

	// Only WebMCP-supported annotation keys (unknown keys can break registration).
	return {
		readOnlyHint: !!annotations.readonly,
	};
}

/**
 * @param {unknown} result
 * @return {{ content: Array<{ type: string, text: string }>, structuredContent?: Object }} The WebMCP tool result.
 */
function formatToolResult(result) {
	if (result === undefined) {
		return { content: [{ type: "text", text: "" }] };
	}

	const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
	const formatted = { content: [{ type: "text", text }] };

	if (result !== null && typeof result === "object" && !Array.isArray(result)) {
		formatted.structuredContent = result;
	}

	return formatted;
}

/**
 * Surface ability failures as tool errors the agent can read and retry from,
 * rather than rejecting the execute() call.
 *
 * @param {unknown} error
 * @return {{ content: Array<{ type: string, text: string }>, isError: true }} The WebMCP tool error result.
 */
export function formatToolError(error) {
	const formatted = {
		content: [{ type: "text", text: String(error?.message || error) }],
		isError: true,
	};

	if (
		typeof error?.fallbackTool === "string" &&
		error.fallbackArguments &&
		typeof error.fallbackArguments === "object" &&
		!Array.isArray(error.fallbackArguments)
	) {
		formatted.structuredContent = {
			fallbackTool: error.fallbackTool,
			fallbackArguments: error.fallbackArguments,
		};
	}

	return formatted;
}

/**
 * Copy a JSON Schema, recursing into properties and items.
 *
 * @param {Object}  schema
 * @param {boolean} collapseNullableTypes Replace ['string','null'] with 'string'.
 * @return {Object|undefined} The normalized schema, or undefined when there is nothing to normalize.
 */
function normalizeSchema(schema, collapseNullableTypes) {
	if (!schema || typeof schema !== "object") {
		return undefined;
	}

	const normalized = { ...schema };

	if (collapseNullableTypes && Array.isArray(normalized.type)) {
		const nonNull = normalized.type.filter((type) => type !== "null");
		normalized.type = nonNull[0] || "string";
	}

	if (normalized.properties && typeof normalized.properties === "object") {
		const properties = {};
		for (const [key, value] of Object.entries(normalized.properties)) {
			const property = normalizeSchema(value, collapseNullableTypes);
			if (property) {
				properties[key] = property;
			}
		}
		normalized.properties = properties;
	}

	if (normalized.items) {
		normalized.items = normalizeSchema(normalized.items, collapseNullableTypes) ?? normalized.items;
	}

	return normalized;
}

/**
 * @param {Object} [schema]
 * @return {Object} The WebMCP tool input schema.
 */
function toToolInputSchema(schema) {
	const normalized = normalizeSchema(schema, true);
	if (!normalized || normalized.type !== "object") {
		return { type: "object", properties: {} };
	}

	if (!normalized.properties || typeof normalized.properties !== "object") {
		normalized.properties = {};
	}

	return normalized;
}

/**
 * @param {Object} [schema]
 * @return {Object|undefined} The WebMCP tool output schema, or undefined when there is none.
 */
function toToolOutputSchema(schema) {
	const normalized = normalizeSchema(schema, false);
	if (!normalized || normalized.type !== "object") {
		return undefined;
	}
	return normalized;
}

/**
 * @param {unknown} error
 * @return {boolean} Whether the error indicates the tool was already registered.
 */
function isAlreadyRegisteredError(error) {
	if (error?.name === "InvalidStateError") {
		return true;
	}
	return /already/i.test(String(error?.message || error));
}

/**
 * @return {boolean} Whether the document has finished loading.
 */
function isDocumentLoaded() {
	if (typeof document === "undefined" || !document.readyState) {
		return true;
	}
	return document.readyState === "complete";
}

/**
 * Wait briefly for WebMCP to become available (flag / document ready races).
 *
 * @param {number} [timeoutMs]
 * @param {number} [graceAfterLoadMs]
 * @return {Promise<Object|null>} The model context, or null when it never became available.
 */
async function waitForModelContext(timeoutMs = 3000, graceAfterLoadMs = 500) {
	const started = Date.now();
	let loadedAt = isDocumentLoaded() ? started : null;

	while (Date.now() - started < timeoutMs) {
		const modelContext = getModelContext();
		if (modelContext?.registerTool) {
			return modelContext;
		}

		if (loadedAt === null && isDocumentLoaded()) {
			loadedAt = Date.now();
		}
		if (loadedAt !== null && Date.now() - loadedAt >= graceAfterLoadMs) {
			break;
		}

		await new Promise((resolve) => window.setTimeout(resolve, 50));
	}

	return getModelContext();
}

/**
 * Register one ability as a page-lifetime WebMCP tool (no AbortSignal — see
 * docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md, "Do not
 * register WebMCP tools with a shared AbortController for page-lifetime tools").
 *
 * @param {string} abilityName
 * @param {Object} modelContext
 * @return {Promise<boolean>} Resolves true once the tool is registered.
 */
async function registerAbilityAsWebMCPTool(abilityName, modelContext) {
	const ability = getAbility(abilityName);
	if (!ability) {
		throw new Error(`Ability not found: ${abilityName}`);
	}

	const tool = {
		name: toToolName(abilityName),
		description: ability.description || ability.label || abilityName,
		inputSchema: toToolInputSchema(ability.input_schema),
		execute: async (input = {}) => {
			try {
				const result = await executeAbility(abilityName, input || {});
				return formatToolResult(result);
			} catch (error) {
				console.warn(`[nfd-editor-chat] Local ability failed: ${abilityName}`, error);
				return formatToolError(error);
			}
		},
	};

	const optional = {};
	const outputSchema = toToolOutputSchema(ability.output_schema);
	if (outputSchema) {
		optional.outputSchema = outputSchema;
	}
	const annotations = toToolAnnotations(ability);
	if (annotations) {
		optional.annotations = annotations;
	}

	try {
		await modelContext.registerTool({ ...tool, ...optional });
	} catch (error) {
		if (isAlreadyRegisteredError(error)) {
			throw error;
		}
		// Older WebMCP builds reject descriptor keys they do not know about;
		// a tool without hints beats no tool at all.
		await modelContext.registerTool(tool);
	}

	return true;
}

/**
 * Bridge abilities to WebMCP.
 *
 * @param {string[]} abilityNames
 * @return {Promise<{ supported: boolean, registered: string[], skipped: string[], errors: Object[] }>} The bridging result.
 */
export async function bridgeAbilitiesToWebMCP(abilityNames) {
	const modelContext = await waitForModelContext();
	if (!modelContext?.registerTool) {
		return {
			supported: false,
			registered: [],
			skipped: [...abilityNames],
			errors: [],
		};
	}

	const registered = [];
	const skipped = [];
	const errors = [];

	for (const name of abilityNames) {
		try {
			await registerAbilityAsWebMCPTool(name, modelContext);
			registered.push(name);
		} catch (error) {
			const message = String(error?.message || error);
			if (isAlreadyRegisteredError(error)) {
				registered.push(name);
				continue;
			}

			console.warn(`[nfd-editor-chat] Failed to register WebMCP tool for ${name}:`, error);
			skipped.push(name);
			errors.push({ name, message });
		}
	}

	return { supported: true, registered, skipped, errors };
}

/**
 * @return {boolean} Whether WebMCP is supported in this environment.
 */
export function isWebMCPSupported() {
	const modelContext = getModelContext();
	return !!(modelContext && "registerTool" in modelContext);
}
