/* eslint-disable no-console */
/**
 * OpenAI Client that proxies requests through WordPress REST API
 *
 * This client uses the OpenAI SDK configured to route requests through
 * the WordPress proxy endpoint, which then forwards to Cloudflare AI Gateway
 * or direct OpenAI API.
 */
import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Custom error class for OpenAI errors
 */
export class OpenAIError extends Error {
	constructor(message, status = null, code = null) {
		super(message);
		this.name = "OpenAIError";
		this.status = status;
		this.code = code;
	}
}

/**
 * OpenAI client that proxies requests through WordPress REST API
 */
class CloudflareOpenAIClient {
	constructor() {
		this.openai = null;
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
				restUrl: window.nfdEditorChat.restUrl,
				homeUrl: window.nfdEditorChat.homeUrl,
				currentUser: window.nfdEditorChat.currentUser || {},
			};
		} else {
			this.config = {
				nonce: "",
				restUrl: "",
				homeUrl: "",
				currentUser: {},
			};
		}

		return this.config;
	}

	/**
	 * Initialize the OpenAI client
	 *
	 * @return {OpenAI} OpenAI client instance
	 */
	getOpenAIClient() {
		if (this.openai) {
			return this.openai;
		}

		const config = this.getConfig();

		// Use WordPress proxy endpoint - all authentication handled server-side
		this.openai = new OpenAI({
			apiKey: "proxy", // Dummy key - real key is on the server
			baseURL: `${config.restUrl}ai`,
			dangerouslyAllowBrowser: true,
			defaultHeaders: {
				"X-WP-Nonce": config.nonce,
			},
		});

		return this.openai;
	}

	/**
	 * Create a chat completion request (non-streaming)
	 *
	 * @param {Object} request Chat completion request params
	 * @return {Promise<Object>} Chat completion response
	 */
	async createChatCompletion(request) {
		try {
			const openai = this.getOpenAIClient();
			const response = await openai.chat.completions.create({
				model: request.model || DEFAULT_MODEL,
				messages: request.messages,
				tools: request.tools,
				tool_choice: request.tool_choice,
				stream: false,
				max_tokens: request.max_tokens,
				temperature: request.temperature,
			});

			return response;
		} catch (error) {
			throw new OpenAIError(error.message || "OpenAI API request failed", error.status, error.code);
		}
	}

	/**
	 * Create a streaming chat completion
	 *
	 * @param {Object}   request    Chat completion request params
	 * @param {Function} onChunk    Callback for each chunk
	 * @param {Function} onComplete Callback when complete
	 * @param {Function} onError    Callback for errors
	 * @return {Promise<void>}
	 */
	async createStreamingCompletion(request, onChunk, onComplete, onError) {
		try {
			const openai = this.getOpenAIClient();
			const stream = await openai.chat.completions.create({
				...request,
				messages: request.messages,
				stream: true,
			});

			let fullMessage = "";
			const toolCallsInProgress = {};

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta;

				if (delta?.content) {
					fullMessage += delta.content;
					onChunk({
						type: "content",
						content: delta.content,
					});
				}

				// Handle streaming tool calls
				if (delta?.tool_calls) {
					for (const toolCall of delta.tool_calls) {
						const index = toolCall.index;

						if (!toolCallsInProgress[index]) {
							toolCallsInProgress[index] = {
								id: toolCall.id || "",
								type: "function",
								function: {
									name: toolCall.function?.name || "",
									arguments: "",
								},
							};
						}

						if (toolCall.id) {
							toolCallsInProgress[index].id = toolCall.id;
						}

						if (toolCall.function?.name) {
							toolCallsInProgress[index].function.name = toolCall.function.name;
						}

						if (toolCall.function?.arguments) {
							toolCallsInProgress[index].function.arguments += toolCall.function.arguments;
						}
					}

					onChunk({
						type: "tool_calls",
						tool_calls: Object.values(toolCallsInProgress),
					});
				}

				if (chunk.choices[0]?.finish_reason) {
					// Convert tool calls to final format
					const finalToolCalls = Object.values(toolCallsInProgress).map((tc) => ({
						id: tc.id,
						name: tc.function.name,
						arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
					}));

					// Await onComplete in case it's async (e.g., handles tool calls)
					await onComplete(fullMessage, finalToolCalls.length > 0 ? finalToolCalls : null);
					break;
				}
			}
		} catch (error) {
			onError(
				new OpenAIError(error.message || "Streaming request failed", error.status, error.code)
			);
		}
	}

	/**
	 * Convert chat messages to OpenAI format
	 *
	 * OpenAI requires that tool messages MUST follow an assistant message with tool_calls.
	 * This function ensures that constraint is satisfied.
	 *
	 * @param {Array} messages Array of chat messages
	 * @return {Array} OpenAI formatted messages
	 */
	convertMessagesToOpenAI(messages) {
		const openaiMessages = [];

		for (const message of messages) {
			if (message.role === "system" || message.role === "user") {
				openaiMessages.push({
					role: message.role,
					content: message.content ?? "", // Use nullish coalescing for safety
				});
			} else if (message.role === "assistant") {
				// Check for valid content and tool calls
				const hasToolCalls = message.toolCalls && message.toolCalls.length > 0;
				const hasContent = message.content != null && message.content !== "";

				// Skip invalid assistant messages (no content AND no tool calls)
				// OpenAI requires either content OR tool_calls for assistant messages
				if (!hasContent && !hasToolCalls) {
					console.warn("Skipping invalid assistant message with no content and no tool calls");
					continue;
				}

				const assistantMessage = {
					role: "assistant",
					// When there are tool_calls, content can be null (OpenAI allows this)
					// When there are no tool_calls, content must be a string
					content: hasToolCalls ? (message.content ?? null) : (message.content ?? ""),
				};

				// Add tool calls if present
				if (hasToolCalls) {
					assistantMessage.tool_calls = message.toolCalls.map((call) => ({
						id: call.id,
						type: "function",
						function: {
							name: call.name,
							arguments:
								typeof call.arguments === "string"
									? call.arguments
									: JSON.stringify(call.arguments),
						},
					}));
				}

				openaiMessages.push(assistantMessage);

				// ONLY add tool results if there are corresponding tool_calls
				// OpenAI requires tool messages to follow an assistant message with tool_calls
				if (hasToolCalls && message.toolResults && message.toolResults.length > 0) {
					for (const result of message.toolResults) {
						// Only add if this result has a matching tool call
						const hasMatchingCall = message.toolCalls.some((call) => call.id === result.id);
						if (hasMatchingCall) {
							openaiMessages.push({
								role: "tool",
								content: result.error || JSON.stringify(result.result),
								tool_call_id: result.id,
							});
						}
					}
				}
			}
			// Skip standalone tool messages - they're only valid after assistant tool_calls
			// which we handle above
		}

		return openaiMessages;
	}

	/**
	 * Convert MCP tools to OpenAI tools format
	 *
	 * @param {Array} mcpTools Array of MCP tools
	 * @return {Array} OpenAI tools array
	 */
	convertMCPToolsToOpenAI(mcpTools) {
		return mcpTools.map((tool) => ({
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: tool.inputSchema,
			},
		}));
	}

	/**
	 * Process tool calls from OpenAI response
	 *
	 * @param {Array} toolCalls Raw tool calls from OpenAI
	 * @return {Array} Processed tool calls
	 */
	processToolCalls(toolCalls) {
		return toolCalls.map((call) => ({
			id: call.id,
			name: call.function.name,
			arguments: JSON.parse(call.function.arguments || "{}"),
		}));
	}

	/**
	 * Send a simple chat message
	 *
	 * @param {string} message User message
	 * @param {Array}  context Previous messages for context
	 * @param {Array}  tools   Available MCP tools
	 * @return {Promise<Object>} Response with message and optional tool calls
	 */
	async sendMessage(message, context = [], tools = []) {
		const messages = this.convertMessagesToOpenAI([
			...context,
			{
				id: `user-${Date.now()}`,
				role: "user",
				content: message,
				timestamp: new Date(),
			},
		]);

		const request = {
			model: DEFAULT_MODEL,
			messages,
			tools: tools.length > 0 ? this.convertMCPToolsToOpenAI(tools) : undefined,
			tool_choice: tools.length > 0 ? "auto" : undefined,
			temperature: 0.7,
			max_tokens: 2000,
		};

		try {
			const response = await this.createChatCompletion(request);
			const choice = response.choices[0];

			if (!choice) {
				throw new OpenAIError("No response from OpenAI");
			}

			const result = {
				message: choice.message.content || "",
			};

			if (choice.message.tool_calls) {
				result.toolCalls = this.processToolCalls(choice.message.tool_calls);
			}

			return result;
		} catch (error) {
			if (error instanceof OpenAIError) {
				throw error;
			}
			throw new OpenAIError(`Failed to send message: ${error}`);
		}
	}

	/**
	 * Create a system message for WordPress context
	 *
	 * @return {Object} System message object
	 */
	createWordPressSystemMessage() {
		const config = this.getConfig();

		return {
			role: "system",
			content: `You are a helpful AI assistant integrated into a WordPress editor. You specialize in managing global styles and color palettes.

## How to Use MCP Tools

You have THREE tools available:
1. **mcp-adapter-discover-abilities** - Lists all available WordPress abilities
2. **mcp-adapter-get-ability-info** - Gets detailed info about a specific ability  
3. **mcp-adapter-execute-ability** - EXECUTES an ability to perform actions

## Bluehost Blueprint Theme Color Mappings

This site uses the Bluehost Blueprint theme with these color slugs:
- **accent-2** = Primary color (main brand color)
- **accent-5** = Secondary color
- **base** = Background color
- **contrast** = Text color
- **accent-1** = Darkest accent shade
- **accent-3, accent-4, accent-6** = Lighter accent shades

### Color Request Mappings:
- "primary color" or "main color" → use slug \`accent-2\`
- "secondary color" → use slug \`accent-5\`
- "background color" → use slug \`base\`
- "text color" or "foreground" → use slug \`contrast\`

### Accent Palette Generation (for primary color changes):
When changing the primary/accent color, generate ALL 6 accent shades from the provided color:
- **accent-1**: Darkest (lightness -24%, saturation -3%)
- **accent-2**: Primary color (unchanged - this is the user's color)
- **accent-3**: Lighter (lightness +18%, saturation +1%)
- **accent-4**: Lighter (lightness +28%, saturation +2%)
- **accent-5**: Lighter (lightness +56%, saturation +3%)
- **accent-6**: Lightest (lightness +63%, saturation +5%)

## Available Abilities

- \`nfd-editor-chat/get-global-styles\` - Get current palette
- \`nfd-editor-chat/update-global-palette\` - Update colors

## Examples

User: "Change the primary color to blue (#0073aa)"
Call update-global-palette with ALL accent colors generated from blue:
{ "colors": [
  { "slug": "accent-1", "color": "#003d5c", "name": "Accent 1" },
  { "slug": "accent-2", "color": "#0073aa", "name": "Accent 2" },
  { "slug": "accent-3", "color": "#3399cc", "name": "Accent 3" },
  { "slug": "accent-4", "color": "#66b3d9", "name": "Accent 4" },
  { "slug": "accent-5", "color": "#b3d9ec", "name": "Accent 5" },
  { "slug": "accent-6", "color": "#cce6f2", "name": "Accent 6" }
] }

User: "Change the background to #d3d3d3"
Call: mcp-adapter-execute-ability with { "ability_name": "nfd-editor-chat/update-global-palette", "parameters": { "colors": [{ "slug": "base", "color": "#d3d3d3", "name": "Base" }] } }

User: "Make the text color black"
Call: mcp-adapter-execute-ability with { "ability_name": "nfd-editor-chat/update-global-palette", "parameters": { "colors": [{ "slug": "contrast", "color": "#000000", "name": "Contrast" }] } }

## Guidelines
- Use the EXACT color slugs listed above for this theme
- When changing primary color, generate ALL 6 accent shades
- For background changes, use "base" slug
- For text changes, use "contrast" slug
- All colors must be in HEX format (#RRGGBB)

Site: ${config.homeUrl} | User: ${config.currentUser?.display_name || "Unknown"}`,
		};
	}
}

// Export a singleton instance
export const openaiClient = new CloudflareOpenAIClient();

export default openaiClient;
