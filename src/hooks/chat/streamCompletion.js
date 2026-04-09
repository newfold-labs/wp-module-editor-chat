/* eslint-disable no-undef, no-console */
/**
 * streamCompletion — Streams an OpenAI chat completion and accumulates tool calls.
 *
 * Plain async function (no React hooks). The orchestrator wraps it in useCallback.
 */
import { safeParseJSON } from "../../utils/jsonUtils";

/**
 * Stream a chat completion and accumulate tool calls.
 *
 * @param {Array}  msgs      Messages array for the API
 * @param {Array}  tools     OpenAI tools array
 * @param {Object} [options] Extra options (model, temperature, stripPrefix, silent, etc.)
 * @param {Object} deps      Dependencies: { openaiClientRef, abortControllerRef, setCurrentResponse }
 * @return {Promise<{content: string, toolCalls: Array|null, finishReason: string|null}>} Streamed completion result
 */
export async function streamCompletion(msgs, tools, options = {}, deps) {
	const { openaiClientRef, abortControllerRef, setCurrentResponse } = deps;

	const client = openaiClientRef.current;
	if (!client) {
		throw new Error("OpenAI client not initialized");
	}

	// Model is controlled by the Worker's DEFAULT_MODEL env var.
	// Only override if explicitly set via wp-config NFD_EDITOR_CHAT_MODEL.
	const model = options.model || window.nfdEditorChat?.model || undefined;
	const controller = new AbortController();
	abortControllerRef.current = controller;

	const stream = await client.chat.completions.create(
		{
			model,
			messages: msgs,
			tools: tools.length > 0 ? tools : undefined,
			tool_choice: tools.length > 0 ? "auto" : undefined,
			stream: true,
			stream_options: { include_usage: true },
			temperature: options.temperature ?? 0.7,
			max_completion_tokens: options.max_completion_tokens,
		},
		{ signal: controller.signal }
	);

	let fullMessage = "";
	let finishReason = null;
	const toolCallsInProgress = {};

	// Prefix stripping: buffer early chars to hide [PLAN] from the UI
	const stripPrefix = options.stripPrefix || null;
	let prefixBuffer = "";
	let prefixResolved = !stripPrefix; // skip buffering if no prefix to strip

	for await (const chunk of stream) {
		const delta = chunk.choices?.[0]?.delta;
		if (!delta) {
			// Usage-only chunk or empty
			if (chunk.usage) {
				console.log(
					`[Token Usage] prompt: ${chunk.usage.prompt_tokens} | completion: ${chunk.usage.completion_tokens} | total: ${chunk.usage.total_tokens}`
				);
			}
			continue;
		}

		// Text content
		if (delta.content) {
			fullMessage += delta.content;

			// Silent mode: accumulate content but don't stream to UI
			if (options.silent) {
				continue;
			}

			if (!prefixResolved) {
				prefixBuffer += delta.content;
				if (prefixBuffer.length >= stripPrefix.length) {
					prefixResolved = true;
					if (prefixBuffer.startsWith(stripPrefix)) {
						// Strip prefix, stream the remainder
						const remainder = prefixBuffer.slice(stripPrefix.length);
						if (remainder) {
							setCurrentResponse((prev) => prev + remainder);
						}
					} else {
						// Not a match, flush entire buffer
						setCurrentResponse((prev) => prev + prefixBuffer);
					}
				}
				// Still buffering — don't update UI yet
			} else {
				// Strip duplicate [PLAN] markers and tool-call leakage from streaming display
				const cleaned = stripPrefix
					? delta.content.replace(/\[PLAN\]/g, "").replace(/=fn\.\S*/g, "")
					: delta.content;
				if (cleaned) {
					setCurrentResponse((prev) => prev + cleaned);
				}
			}
		}

		// Tool call deltas
		if (delta.tool_calls) {
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
		}

		if (chunk.choices?.[0]?.finish_reason) {
			finishReason = chunk.choices[0].finish_reason;
		}
	}

	// Flush any unresolved prefix buffer (response shorter than prefix length)
	if (!prefixResolved && prefixBuffer) {
		setCurrentResponse((prev) => prev + prefixBuffer);
	}

	abortControllerRef.current = null;

	// Parse accumulated tool calls (with recovery for truncated JSON)
	const finalToolCalls = Object.values(toolCallsInProgress).map((tc) => {
		if (!tc.function.arguments) {
			return { id: tc.id, name: tc.function.name, arguments: {} };
		}
		const { value, recovered } = safeParseJSON(tc.function.arguments);
		const isTruncated = recovered && Object.keys(value).length === 0;
		return {
			id: tc.id,
			name: tc.function.name,
			arguments: value,
			_truncated: isTruncated,
		};
	});

	return {
		content: fullMessage,
		toolCalls: finalToolCalls.length > 0 ? finalToolCalls : null,
		finishReason,
	};
}
