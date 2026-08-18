/**
 * MCP gateway wrapper.
 *
 * The MCP server only exposes 3 gateway tools (blu-list-abilities,
 * blu-get-ability-schema, blu-call-ability) — every other blu-* ability
 * must be invoked through blu-call-ability. This wrapper hides that detail
 * from individual tool handlers.
 */

/**
 * Gateway tools exposed directly by the MCP server. Every other ability
 * must be reached through blu-call-ability.
 */
const GATEWAY_TOOLS = new Set(["blu-list-abilities", "blu-get-ability-schema", "blu-call-ability"]);

/**
 * Call a blu-* ability via the MCP server, wrapping through blu-call-ability
 * when the ability is not one of the gateway tools.
 *
 * @param {Object} mcpClient   The MCP client instance.
 * @param {string} abilityName Hyphen-form ability name (e.g. "blu-generate-image").
 * @param {Object} parameters  Parameters for the inner ability.
 * @return {Promise<Object>} MCP result.
 */
export function callAbility(mcpClient, abilityName, parameters) {
	if (!abilityName.startsWith("blu-") || GATEWAY_TOOLS.has(abilityName)) {
		return mcpClient.callTool(abilityName, parameters);
	}
	return mcpClient.callTool("blu-call-ability", {
		ability_name: abilityName,
		parameters: parameters || {},
	});
}

/**
 * Whether an MCP result represents a failed ability call.
 *
 * The PHP side never sets MCP's `isError` flag; failure is reported in the
 * payload status instead, so without this a 502 looks like a success.
 *
 * @param {Object} mcpResult Result from callAbility / mcpClient.callTool.
 * @return {boolean} True when the call failed.
 */
export function mcpResultIsError(mcpResult) {
	if (!mcpResult) {
		return true;
	}
	if (mcpResult.isError) {
		return true;
	}
	const text = mcpResult.content?.[0]?.text;
	if (typeof text !== "string") {
		return false;
	}
	try {
		const parsed = JSON.parse(text);
		if (typeof parsed?.statusCode === "number") {
			return parsed.statusCode >= 400;
		}
		return parsed?.status === "error";
	} catch {
		// Not an ability envelope; leave it to the existing content handling.
		return false;
	}
}
