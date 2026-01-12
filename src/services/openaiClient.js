/**
 * OpenAI Client for WordPress
 *
 * Handles streaming chat completions through WordPress REST API proxy.
 * Supports tool calls and MCP integration.
 */

/* global window, fetch, TextDecoder */

const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Custom error class for OpenAI operations
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
 * OpenAI Client class for WordPress
 */
export class WordPressOpenAIClient {
	constructor() {
		this.abortController = null;
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
			restUrl: config.restUrl || "/wp-json/nfd-editor-chat/v1/",
			homeUrl: config.homeUrl || "",
			currentUser: config.currentUser || { display_name: "User" },
		};
	}

	/**
	 * Create a streaming chat completion
	 *
	 * @param {Object}   options            Request options
	 * @param {Array}    options.messages   Chat messages
	 * @param {Array}    options.tools      Available tools (optional)
	 * @param {string}   options.model      Model to use (optional)
	 * @param {number}   options.maxTokens  Max tokens (optional)
	 * @param {number}   options.temperature Temperature (optional)
	 * @param {Function} onChunk            Callback for each chunk
	 * @param {Function} onToolCall         Callback for tool calls
	 * @param {Function} onComplete         Callback when complete
	 * @param {Function} onError            Callback on error
	 * @return {Promise<void>}
	 */
	async createStreamingCompletion(
		{ messages, tools = [], model = DEFAULT_MODEL, maxTokens = 2000, temperature = 0.7 },
		onChunk,
		onToolCall,
		onComplete,
		onError
	) {
		const config = this.getConfig();

		// Create abort controller for this request
		this.abortController = new AbortController();

		try {
			const requestBody = {
				model,
				messages,
				stream: true,
				max_tokens: maxTokens,
				temperature,
			};

			// Add tools if available
			if (tools && tools.length > 0) {
				requestBody.tools = tools;
				requestBody.tool_choice = "auto";
			}

			const response = await fetch(`${config.restUrl}ai/stream`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-WP-Nonce": config.nonce,
				},
				body: JSON.stringify(requestBody),
				signal: this.abortController.signal,
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new OpenAIError(
					errorData.message || `HTTP error: ${response.status}`,
					response.status,
					errorData.code
				);
			}

			// Process the stream
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let fullContent = "";
			const toolCalls = [];
			let currentToolCall = null;

			while (true) {
				const { done, value } = await reader.read();

				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });

				// Process SSE events
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim();

						if (data === "[DONE]") {
							continue;
						}

						try {
							const parsed = JSON.parse(data);
							const delta = parsed.choices?.[0]?.delta;
							const finishReason = parsed.choices?.[0]?.finish_reason;

							if (delta) {
								// Handle content chunks
								if (delta.content) {
									fullContent += delta.content;
									if (onChunk) {
										onChunk({
											type: "content",
											content: delta.content,
											fullContent,
										});
									}
								}

								// Handle tool calls
								if (delta.tool_calls) {
									for (const toolCallDelta of delta.tool_calls) {
										const index = toolCallDelta.index;

										if (!toolCalls[index]) {
											toolCalls[index] = {
												id: toolCallDelta.id || "",
												type: "function",
												function: {
													name: "",
													arguments: "",
												},
											};
										}

										currentToolCall = toolCalls[index];

										if (toolCallDelta.id) {
											currentToolCall.id = toolCallDelta.id;
										}

										if (toolCallDelta.function?.name) {
											currentToolCall.function.name = toolCallDelta.function.name;
										}

										if (toolCallDelta.function?.arguments) {
											currentToolCall.function.arguments += toolCallDelta.function.arguments;
										}
									}
								}
							}

							// Check for completion
							if (finishReason === "tool_calls" && toolCalls.length > 0) {
								// Process tool calls
								const processedToolCalls = toolCalls.map((tc) => ({
									id: tc.id,
									name: tc.function.name,
									arguments: this.safeParseJSON(tc.function.arguments),
								}));

								if (onToolCall) {
									onToolCall(processedToolCalls);
								}
							} else if (finishReason === "stop") {
								if (onComplete) {
									onComplete({
										content: fullContent,
										toolCalls: toolCalls.length > 0 ? toolCalls : null,
									});
								}
							}
						} catch {
							// Ignore JSON parse errors for malformed chunks
						}
					}
				}
			}

			// Final completion callback if not already called
			if (onComplete && fullContent) {
				onComplete({
					content: fullContent,
					toolCalls: toolCalls.length > 0 ? toolCalls : null,
				});
			}
		} catch (error) {
			if (error.name === "AbortError") {
				return; // Request was cancelled
			}

			const openAIError =
				error instanceof OpenAIError ? error : new OpenAIError(error.message || "Streaming request failed");

			if (onError) {
				onError(openAIError);
			} else {
				throw openAIError;
			}
		} finally {
			this.abortController = null;
		}
	}

	/**
	 * Send a non-streaming chat completion (for follow-up with tool results)
	 *
	 * @param {Object} options Request options
	 * @return {Promise<Object>} Response with content and optional tool calls
	 */
	async createChatCompletion({
		messages,
		tools = [],
		model = DEFAULT_MODEL,
		maxTokens = 2000,
		temperature = 0.7,
	}) {
		const config = this.getConfig();

		const requestBody = {
			model,
			messages,
			stream: false,
			max_tokens: maxTokens,
			temperature,
		};

		if (tools && tools.length > 0) {
			requestBody.tools = tools;
			requestBody.tool_choice = "auto";
		}

		const response = await fetch(`${config.restUrl}ai/stream`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-WP-Nonce": config.nonce,
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}));
			throw new OpenAIError(
				errorData.message || `HTTP error: ${response.status}`,
				response.status,
				errorData.code
			);
		}

		const data = await response.json();
		const choice = data.choices?.[0];

		if (!choice) {
			throw new OpenAIError("No response from AI");
		}

		const result = {
			content: choice.message?.content || "",
			toolCalls: null,
		};

		if (choice.message?.tool_calls) {
			result.toolCalls = choice.message.tool_calls.map((tc) => ({
				id: tc.id,
				name: tc.function.name,
				arguments: this.safeParseJSON(tc.function.arguments),
			}));
		}

		return result;
	}

	/**
	 * Stop the current streaming request
	 */
	stop() {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}

	/**
	 * Safely parse JSON string
	 *
	 * @param {string} str JSON string
	 * @return {Object} Parsed object or empty object
	 */
	safeParseJSON(str) {
		try {
			return JSON.parse(str || "{}");
		} catch {
			return {};
		}
	}

	/**
	 * Convert chat messages to OpenAI format
	 *
	 * @param {Array} messages Chat messages
	 * @return {Array} OpenAI formatted messages
	 */
	convertMessagesToOpenAI(messages) {
		const openaiMessages = [];

		for (const message of messages) {
			if (message.role === "system" || message.role === "user") {
				openaiMessages.push({
					role: message.role,
					content: message.content,
				});
			} else if (message.role === "assistant") {
				const assistantMessage = {
					role: "assistant",
					content: message.content,
				};

				// Add tool calls if present
				if (message.toolCalls && message.toolCalls.length > 0) {
					assistantMessage.tool_calls = message.toolCalls.map((call) => ({
						id: call.id,
						type: "function",
						function: {
							name: call.name,
							arguments: JSON.stringify(call.arguments),
						},
					}));
				}

				openaiMessages.push(assistantMessage);

				// Add tool results as separate tool messages
				if (message.toolResults && message.toolResults.length > 0) {
					for (const result of message.toolResults) {
						openaiMessages.push({
							role: "tool",
							content: result.error || JSON.stringify(result.result),
							tool_call_id: result.id,
						});
					}
				}
			}
		}

		return openaiMessages;
	}

	/**
	 * Create a WordPress context system message
	 *
	 * @return {Object} System message object
	 */
	createSystemMessage() {
		const config = this.getConfig();

		return {
			role: "system",
			content: `You are a helpful AI assistant integrated into a WordPress editor. You can interact with WordPress through MCP (Model Context Protocol) tools.

Available capabilities:
- Create, read, update, and manage WordPress posts and pages
- Access site information and settings
- Interact with the WordPress system through predefined tools

Guidelines:
- Always be helpful and provide accurate information
- When performing WordPress actions, explain what you're doing
- Ask for confirmation before making significant changes
- Respect user permissions and WordPress security
- Provide clear, actionable responses

Site Information:
- Site URL: ${config.homeUrl}
- Current User: ${config.currentUser?.display_name || "User"}

You should use the available MCP tools to interact with WordPress when users request actions like creating posts, managing content, or retrieving site information.`,
		};
	}
}

// Export a singleton instance
export const openaiClient = new WordPressOpenAIClient();

export default openaiClient;
