import { executeAbility, getAbility } from "@wordpress/abilities";

import { getModelContext } from "./webmcp-env";

const ownedToolsByContext = new WeakMap();

export function toToolName(abilityName) {
	return abilityName.replaceAll("/", "_");
}

function normalizeSchema(schema, collapseNullableTypes) {
	if (!schema || typeof schema !== "object") {
		return undefined;
	}
	const normalized = { ...schema };
	if (collapseNullableTypes && Array.isArray(normalized.type)) {
		normalized.type = normalized.type.find((type) => type !== "null") || "string";
	}
	if (normalized.properties) {
		normalized.properties = Object.fromEntries(
			Object.entries(normalized.properties)
				.map(([key, value]) => [key, normalizeSchema(value, collapseNullableTypes)])
				.filter(([, value]) => value)
		);
	}
	if (normalized.items) {
		normalized.items = normalizeSchema(normalized.items, collapseNullableTypes) || normalized.items;
	}
	return normalized;
}

function formatToolResult(result) {
	let text = "";
	if (typeof result === "string") {
		text = result;
	} else if (result !== undefined) {
		text = JSON.stringify(result);
	}
	const formatted = {
		content: [{ type: "text", text }],
		isError: false,
	};
	if (result !== null && typeof result === "object" && !Array.isArray(result)) {
		formatted.structuredContent = result;
	}
	return formatted;
}

export function formatToolError(error) {
	const formatted = {
		content: [
			{
				type: "text",
				text: String(error?.message || error),
			},
		],
		isError: true,
	};
	if (
		error?.mutated === false &&
		typeof error.fallbackTool === "string" &&
		error.fallbackArguments &&
		typeof error.fallbackArguments === "object" &&
		!Array.isArray(error.fallbackArguments)
	) {
		formatted.structuredContent = {
			fallbackTool: error.fallbackTool,
			fallbackArguments: error.fallbackArguments,
			mutated: false,
		};
	}
	return formatted;
}

function getInputSchema(ability) {
	const schema = normalizeSchema(ability.input_schema || ability.inputSchema, true);
	if (!schema || schema.type !== "object") {
		return { type: "object", properties: {} };
	}
	return {
		...schema,
		properties: schema.properties || {},
	};
}

function getAnnotations(ability) {
	const annotations = ability.meta?.annotations || ability.annotations;
	if (!annotations) {
		return undefined;
	}
	return {
		readOnlyHint: Boolean(annotations.readonly ?? annotations.readOnlyHint),
	};
}

/**
 * Bridge registered WordPress abilities into one WebMCP context.
 *
 * @param {string[]} abilityNames Ability names to expose.
 * @return {Promise<Object>} Bridge status.
 */
export async function bridgeAbilitiesToWebMCP(abilityNames) {
	const modelContext = getModelContext();
	if (typeof modelContext?.registerTool !== "function") {
		return {
			supported: false,
			registered: [],
			skipped: [...abilityNames],
			errors: [],
		};
	}

	let owned = ownedToolsByContext.get(modelContext);
	if (!owned) {
		owned = new Set();
		ownedToolsByContext.set(modelContext, owned);
	}

	const registered = [];
	const skipped = [];
	const errors = [];
	for (const abilityName of abilityNames) {
		const toolName = toToolName(abilityName);
		if (owned.has(toolName)) {
			registered.push(abilityName);
			continue;
		}
		const ability = getAbility(abilityName);
		if (!ability) {
			skipped.push(abilityName);
			continue;
		}

		const tool = {
			name: toolName,
			title: ability.label || abilityName,
			description: ability.description || ability.label || abilityName,
			inputSchema: getInputSchema(ability),
			execute: async (input = {}) => {
				try {
					return formatToolResult(await executeAbility(abilityName, input || {}));
				} catch (error) {
					return formatToolError(error);
				}
			},
		};
		const annotations = getAnnotations(ability);
		if (annotations) {
			tool.annotations = annotations;
		}
		const outputSchema = normalizeSchema(ability.output_schema || ability.outputSchema, false);
		if (outputSchema?.type === "object") {
			tool.outputSchema = outputSchema;
		}

		try {
			await modelContext.registerTool(tool);
			owned.add(toolName);
			registered.push(abilityName);
		} catch (error) {
			skipped.push(abilityName);
			errors.push({
				name: abilityName,
				message: String(error?.message || error),
			});
		}
	}
	return { supported: true, registered, skipped, errors };
}
