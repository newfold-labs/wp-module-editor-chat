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
