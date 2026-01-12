/**
 * WordPress MCP Client
 *
 * MCP client implementation using the official TypeScript SDK
 * for WordPress integration with nonce-based authentication.
 */

/* eslint-disable no-undef */

// Note: These imports require the @modelcontextprotocol/sdk package to be installed
// eslint-disable-next-line import/no-unresolved
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
// eslint-disable-next-line import/no-unresolved
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Custom error class for MCP operations
 */
export class MCPError extends Error {
	constructor(message, code = null, details = null) {
		super(message);
		this.name = "MCPError";
		this.code = code;
		this.details = details;
	}
}

/**
 * WordPress MCP Client class
 */
export class WordPressMCPClient {
	constructor() {
		this.client = null;
		this.transport = null;
		this.connected = false;
		this.tools = [];
		this.resources = [];
		this.eventListeners = new Map();
	}

	/**
	 * Get WordPress configuration from global variable
	 *
	 * @return {Object} WordPress config
	 */
	getConfig() {
		const config = window.nfdEditorChat || {};
		return {
			nonce: config.nonce || "",
			restUrl: config.restUrl || "/wp-json/",
			mcpUrl: config.mcpUrl || `${config.restUrl || "/wp-json/"}mcp/mcp-adapter-default-server`,
		};
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
					// eslint-disable-next-line no-console
					console.error("Error in MCP event listener:", error);
				}
			});
		}
	}

	/**
	 * Connect to the MCP server
	 *
	 * @return {Promise<void>}
	 */
	async connect() {
		try {
			const config = this.getConfig();

			// Initialize the MCP Client
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
			this.transport = new StreamableHTTPClientTransport(new URL(config.mcpUrl), {
				requestInit: {
					headers: {
						"X-WP-Nonce": config.nonce,
						"Content-Type": "application/json",
					},
				},
			});

			// Connect using the SDK
			await this.client.connect(this.transport);

			this.connected = true;
			this.emit({ type: "connected" });
		} catch (error) {
			const mcpError =
				error instanceof MCPError ? error : new MCPError(`Connection failed: ${error.message}`);
			this.emit({ type: "error", data: mcpError });
			throw mcpError;
		}
	}

	/**
	 * Initialize the MCP session and load tools/resources
	 *
	 * @return {Promise<Object>} Initialization result
	 */
	async initialize() {
		if (!this.connected) {
			throw new MCPError("Not connected to MCP server");
		}

		try {
			// Load tools and resources
			await Promise.all([this.loadTools(), this.loadResources()]);

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
				error instanceof MCPError ? error : new MCPError(`Initialization failed: ${error.message}`);
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

		// Ensure type is set to object
		return {
			type: schema.type || "object",
			properties: schema.properties || {},
			required: Array.isArray(schema.required) ? schema.required : [],
		};
	}

	/**
	 * Load available tools from the MCP server
	 *
	 * @return {Promise<void>}
	 */
	async loadTools() {
		try {
			const result = await this.client.listTools();

			// Convert SDK tools format to our internal format
			this.tools = result.tools.map((tool) => ({
				name: tool.name,
				description: tool.description || "",
				inputSchema: this.normalizeInputSchema(tool.inputSchema),
				// Extract annotations for permission checking
				annotations: tool.annotations || {},
			}));

			this.emit({ type: "tools_updated", data: this.tools });
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("Failed to load tools via SDK:", error);
			this.tools = [];
		}
	}

	/**
	 * Load available resources from the MCP server
	 *
	 * @return {Promise<void>}
	 */
	async loadResources() {
		try {
			const result = await this.client.listResources();

			this.resources = result.resources.map((resource) => ({
				uri: resource.uri,
				name: resource.name || "",
				description: resource.description,
				mimeType: resource.mimeType,
			}));

			this.emit({ type: "resources_updated", data: this.resources });
		} catch (error) {
			// eslint-disable-next-line no-console
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
	 * Call a tool on the MCP server
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
			const result = await this.client.callTool({ name, arguments: args });

			return {
				content: Array.isArray(result.content) ? result.content : [],
				isError: Boolean(result.isError),
				meta: result.meta || {},
			};
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error(`Tool "${name}" call failed:`, error);
			const mcpError =
				error instanceof MCPError ? error : new MCPError(`Tool call failed: ${error.message}`);
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
	 * Read a resource from the MCP server
	 *
	 * @param {string} uri Resource URI
	 * @return {Promise<Object>} Resource content
	 */
	async readResource(uri) {
		if (!this.connected) {
			throw new MCPError("Not connected to MCP server");
		}

		try {
			return await this.client.readResource({ uri });
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error(`Resource "${uri}" read failed:`, error);
			const mcpError =
				error instanceof MCPError ? error : new MCPError(`Resource read failed: ${error.message}`);
			this.emit({ type: "error", data: mcpError });
			throw mcpError;
		}
	}

	/**
	 * Disconnect from the MCP server
	 *
	 * @return {Promise<void>}
	 */
	async disconnect() {
		try {
			if (this.transport) {
				await this.client.close();
				this.transport = null;
			}

			this.connected = false;
			this.tools = [];
			this.resources = [];
			this.emit({ type: "disconnected" });
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("Error during SDK disconnect:", error);
		}
	}

	/**
	 * Check if connected to MCP server
	 *
	 * @return {boolean} Connection status
	 */
	isConnected() {
		return this.connected;
	}

	/**
	 * Get cached tools
	 *
	 * @return {Array} List of tools
	 */
	getTools() {
		return [...this.tools];
	}

	/**
	 * Get cached resources
	 *
	 * @return {Array} List of resources
	 */
	getResources() {
		return [...this.resources];
	}

	/**
	 * Check if a tool is destructive (requires permission)
	 *
	 * @param {string} toolName Tool name to check
	 * @return {boolean} True if destructive
	 */
	isToolDestructive(toolName) {
		const tool = this.tools.find((t) => t.name === toolName);
		if (!tool) {
			return false;
		}

		// Check annotations for destructive flag
		return tool.annotations?.destructive === true || tool.annotations?.readOnly === false;
	}

	/**
	 * Check if a tool is read-only
	 *
	 * @param {string} toolName Tool name to check
	 * @return {boolean} True if read-only
	 */
	isToolReadOnly(toolName) {
		const tool = this.tools.find((t) => t.name === toolName);
		if (!tool) {
			return true; // Default to requiring permission if unknown
		}

		// Check annotations for readonly flag
		return tool.annotations?.readonly === true || tool.annotations?.readOnly === true;
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
			// Use normalizeInputSchema for extra safety in case tools were added without normalization
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
