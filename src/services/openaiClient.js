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
				const hasContent =
					message.content !== null && message.content !== undefined && message.content !== "";

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
}

// Export a singleton instance
export const openaiClient = new CloudflareOpenAIClient();

export default openaiClient;
