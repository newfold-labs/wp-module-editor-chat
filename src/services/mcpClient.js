/* eslint-disable no-console */
/**
 * WordPress MCP Client using the official TypeScript SDK
 *
 * This client uses StreamableHTTPClientTransport to communicate with
 * the WordPress MCP adapter endpoint.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Custom error class for MCP errors
 */
export class MCPError extends Error {
	constructor(message, code = null) {
		super(message);
		this.name = "MCPError";
		this.code = code;
	}
}

/**
 * WordPress MCP Client implementation using the official TypeScript SDK
 */
class WordPressMCPClient {
	constructor() {
		this.client = null;
		this.transport = null;
		this.connected = false;
		this.tools = [];
		this.resources = [];
		this.eventListeners = new Map();
		this.config = null;
	}

	/**
	 * Get configuration from WordPress
	 *
	 * @return {Object} Configuration object
	 */
	getConfig() {
		if (this.config) {
			return this.config;
		}

		// Get config from WordPress localized script
		if (typeof window !== "undefined" && window.nfdEditorChat) {
			this.config = {
				nonce: window.nfdEditorChat.nonce,
				mcpUrl: window.nfdEditorChat.mcpUrl,
				restUrl: window.nfdEditorChat.restUrl,
				homeUrl: window.nfdEditorChat.homeUrl,
			};
		} else {
			this.config = {
				nonce: "",
				mcpUrl: "",
				restUrl: "",
				homeUrl: "",
			};
		}

		return this.config;
	}

	/**
	 * Add event listener
	 *
	 * @param {string}   event    Event name
	 * @param {Function} listener Callback function
	 */
	on(event, listener) {
		if (!this.eventListeners.has(event)) {
			this.eventListeners.set(event, new Set());
		}
		this.eventListeners.get(event).add(listener);
	}

	/**
	 * Remove event listener
	 *
	 * @param {string}   event    Event name
	 * @param {Function} listener Callback function
	 */
	off(event, listener) {
		const listeners = this.eventListeners.get(event);
		if (listeners) {
			listeners.delete(listener);
		}
	}

	/**
	 * Emit event to listeners
	 *
	 * @param {Object} event Event object with type and optional data
	 */
	emit(event) {
		const listeners = this.eventListeners.get(event.type);
		if (listeners) {
			listeners.forEach((listener) => {
				try {
					listener(event);
				} catch (error) {
					console.error("Error in MCP event listener:", error);
				}
			});
		}
	}

	/**
	 * Connect to the MCP server using official SDK StreamableHTTPClientTransport
	 *
	 * @param {string} serverUrl Optional server URL (uses config if not provided)
	 * @return {Promise<void>}
	 */
	async connect(serverUrl = null) {
		try {
			const config = this.getConfig();
			const mcpEndpoint = serverUrl || config.mcpUrl;

			if (!mcpEndpoint) {
				throw new MCPError("MCP endpoint URL not configured");
			}

			// Initialize the MCP Client using the official SDK
			this.client = new Client(
				{
					name: "nfd-editor-chat-client",
					version: "1.0.0",
				},
				{
					capabilities: {},
				}
			);

			// Create HTTP transport with WordPress authentication headers
			this.transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint), {
				requestInit: {
					headers: {
						"X-WP-Nonce": config.nonce,
						"Content-Type": "application/json",
					},
				},
			});

			// Connect using the official SDK
			await this.client.connect(this.transport);

			this.connected = true;
			this.emit({ type: "connected" });
		} catch (error) {
			const mcpError =
				error instanceof MCPError ? error : new MCPError(`Connection failed: ${error}`);
			this.emit({ type: "error", data: mcpError });
			throw mcpError;
		}
	}

	/**
	 * Initialize the MCP session - SDK handles this automatically after connect
	 *
	 * @return {Promise<Object>} Initialization result
	 */
	async initialize() {
		if (!this.connected) {
			throw new MCPError("Not connected to MCP server");
		}

		try {
			// The SDK has already handled initialization during connect()
			// Load initial tools and resources using SDK methods
			await Promise.all([this.loadTools(), this.loadResources()]);

			// Create a compatible result object
			const initResult = {
				protocolVersion: "2025-06-18",
				capabilities: {
					tools: {},
					resources: {},
					prompts: {},
				},
				serverInfo: {
					name: "WordPress MCP Server",
					version: "1.0.0",
				},
			};

			this.emit({ type: "initialized", data: initResult });

			return initResult;
		} catch (error) {
			const mcpError =
				error instanceof MCPError ? error : new MCPError(`Initialization failed: ${error}`);
			this.emit({ type: "error", data: mcpError });
			throw mcpError;
		}
	}

	/**
	 * Normalize input schema to valid JSON Schema object
	 * Handles cases where the MCP server returns empty arrays or invalid schemas
	 *
	 * @param {any} schema Raw input schema from MCP
	 * @return {Object} Valid JSON Schema object
	 */
	normalizeInputSchema(schema) {
		// Handle null, undefined, empty array, or non-object schemas
		if (
			!schema ||
			Array.isArray(schema) ||
			typeof schema !== "object" ||
			Object.keys(schema).length === 0
		) {
			return {
				type: "object",
				properties: {},
				required: [],
			};
		}

		// Ensure type is set to object and properties/required exist
		return {
			type: schema.type || "object",
			properties: schema.properties || {},
			required: Array.isArray(schema.required) ? schema.required : [],
		};
	}

	/**
	 * Load tools using the official MCP SDK
	 *
	 * @return {Promise<void>}
	 */
	async loadTools() {
		try {
			// Use the SDK's listTools method - it handles all the protocol details
			const result = await this.client.listTools();

			// Convert SDK tools format to our internal format with normalized schemas
			this.tools = result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description || "",
				inputSchema: this.normalizeInputSchema(tool.inputSchema),
				annotations: tool.annotations || {},
			}));

			this.emit({ type: "tools_updated", data: this.tools });
		} catch (error) {
			console.error("Failed to load tools via SDK:", error);
			this.tools = [];
		}
	}

	/**
	 * Load resources using the official MCP SDK
	 *
	 * @return {Promise<void>}
	 */
	async loadResources() {
		try {
			// Use the SDK's listResources method - it handles all the protocol details
			const result = await this.client.listResources();

			// Convert SDK resources format to our internal format
			this.resources = result.resources.map((resource) => ({
				uri: resource.uri,
				name: resource.name || "",
				description: resource.description,
				mimeType: resource.mimeType,
			}));

			this.emit({ type: "resources_updated", data: this.resources });
		} catch (error) {
			console.error("Failed to load resources via SDK:", error);
			this.resources = [];
		}
	}

	/**
	 * List available tools
	 *
	 * @return {Promise<Array>} List of tools
	 */
	async listTools() {
		if (!this.connected) {
			throw new MCPError("Not connected to MCP server");
		}
		return this.tools;
	}

	/**
	 * Call a tool using the official MCP SDK
	 *
	 * @param {string} name Tool name
	 * @param {Object} args Tool arguments
	 * @return {Promise<Object>} Tool result
	 */
	async callTool(name, args = {}) {
		if (!this.connected) {
			throw new MCPError("Not connected to MCP server");
		}

		try {
			// Use the SDK's callTool method - it handles all the protocol details
			const result = await this.client.callTool({ name, arguments: args });

			// Convert SDK result format to our internal format
			const toolResult = {
				content: Array.isArray(result.content) ? result.content : [],
				isError: Boolean(result.isError),
				meta: result.meta || {},
			};

			return toolResult;
		} catch (error) {
			console.error(`Tool "${name}" call failed:`, error);
			const mcpError =
				error instanceof MCPError ? error : new MCPError(`Tool call failed: ${error}`);
			this.emit({ type: "error", data: mcpError });
			throw mcpError;
		}
	}

	/**
	 * List available resources
	 *
	 * @return {Promise<Array>} List of resources
	 */
	async listResources() {
		if (!this.connected) {
			throw new MCPError("Not connected to MCP server");
		}
		return this.resources;
	}

	/**
	 * Read a resource using the official MCP SDK
	 *
	 * @param {string} uri Resource URI
	 * @return {Promise<Object>} Resource content
	 */
	async readResource(uri) {
		if (!this.connected) {
			throw new MCPError("Not connected to MCP server");
		}

		try {
			// Use the SDK's readResource method - it handles all the protocol details
			const result = await this.client.readResource({ uri });
			return result;
		} catch (error) {
			console.error(`Resource "${uri}" read failed:`, error);
			const mcpError =
				error instanceof MCPError ? error : new MCPError(`Resource read failed: ${error}`);
			this.emit({ type: "error", data: mcpError });
			throw mcpError;
		}
	}

	/**
	 * Disconnect from the MCP server using the official SDK
	 *
	 * @return {Promise<void>}
	 */
	async disconnect() {
		try {
			// Use the SDK's disconnect method
			if (this.transport) {
				await this.client.close();
				this.transport = null;
			}

			this.connected = false;
			this.tools = [];
			this.resources = [];
			this.emit({ type: "disconnected" });
		} catch (error) {
			console.error("Error during SDK disconnect:", error);
		}
	}

	/**
	 * Get connection status
	 *
	 * @return {boolean} True if connected
	 */
	isConnected() {
		return this.connected;
	}

	/**
	 * Get available tools (cached)
	 *
	 * @return {Array} List of tools
	 */
	getTools() {
		return [...this.tools];
	}

	/**
	 * Get available resources (cached)
	 *
	 * @return {Array} List of resources
	 */
	getResources() {
		return [...this.resources];
	}

	/**
	 * Check if a tool is read-only based on annotations
	 *
	 * @param {string} toolName Tool name to check
	 * @return {boolean} True if tool is read-only
	 */
	isToolReadOnly(toolName) {
		const tool = this.tools.find((t) => t.name === toolName);
		if (!tool) {
			return false;
		}
		// Check annotations for readonly flag
		return tool.annotations?.readonly === true || tool.annotations?.readOnlyHint === true;
	}

	/**
	 * Convert a single MCP tool to OpenAI function format
	 *
	 * @param {Object} tool MCP tool object
	 * @return {Object} OpenAI function format
	 */
	toolToOpenAIFunction(tool) {
		return {
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		};
	}

	/**
	 * Convert all tools to OpenAI functions format
	 *
	 * @return {Array} OpenAI tools array
	 */
	getToolsForOpenAI() {
		return this.tools.map((tool) => {
			// Use normalizeInputSchema for extra safety
			const parameters = this.normalizeInputSchema(tool.inputSchema);

			return {
				type: "function",
				function: {
					name: tool.name,
					description: tool.description || "",
					parameters,
				},
			};
		});
	}
}

// Export a singleton instance
export const mcpClient = new WordPressMCPClient();

export default mcpClient;
