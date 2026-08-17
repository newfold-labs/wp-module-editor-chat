/**
 * streamCompletion — Streams an OpenAI chat completion and accumulates tool calls.
 *
 * Plain async function (no React hooks). The orchestrator wraps it in useCallback.
 */

/**
 * Text safe to display from a partially-streamed structured response.
 *
 * Only ever returns the `message` field, never the envelope around it. Must not
 * fall back to the raw buffer the way getAssistantDisplayMessage does: mid-flight
 * the buffer is often `{"message"` or `{"message":"`, and echoing that flashes
 * raw JSON into the chat before the first word arrives.
 *
 * @param {string} text Accumulated assistant content so far.
 * @return {string|null} Message text, or null when there is nothing safe to show yet.
 */
function partialJsonMessage(text) {
	const trimmed = text.trimStart();
	if (!trimmed) {
		return null;
	}
	// Building toward the JSON contract (or a fenced version of it): show the
	// message field once it has actual characters, and nothing before that.
	if (trimmed.startsWith("{") || trimmed.startsWith("`")) {
		const match = trimmed.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/);
		if (!match) {
			return null;
		}
		const value = match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
		return value ? sanitizeUserFacingMessage(value) : null;
	}
	// Plain prose: the model ignored the contract, so stream it as written.
	return text;
}
import { createAbortError } from "../../utils/abortControl";
import { safeParseJSON } from "../../utils/jsonUtils";
import logger from "../../utils/logger";
import { getAssistantDisplayMessage, sanitizeUserFacingMessage } from "./assistantResponse";
import { MAX_COMPLETION_TOKENS } from "./constants";
import { resetStreamingMessage, upsertStreamingMessage } from "./streamMessageHelpers";

/**
 * Stream a chat completion and accumulate tool calls.
 *
 * @param {Array}  msgs      Messages array for the API
 * @param {Array}  tools     OpenAI tools array
 * @param {Object} [options] Extra options (model, temperature, stripPrefix, silent, resetStream, etc.)
 * @param {Object} deps      Dependencies: { openaiClientRef, abortControllerRef, setMessages }
 * @return {Promise<{content: string, toolCalls: Array|null, finishReason: string|null}>} Streamed completion result
 */
export async function streamCompletion(msgs, tools, options = {}, deps) {
	const { openaiClientRef, abortControllerRef, setMessages } = deps;
	const streamMessageId = options.streamMessageId || null;

	const client = openaiClientRef.current;
	if (!client) {
		throw new Error("OpenAI client not initialized");
	}

	if (options.resetStream && streamMessageId && setMessages) {
		resetStreamingMessage(setMessages, streamMessageId);
	}

	// Model is controlled by the Worker's DEFAULT_MODEL env var.
	// Only override if explicitly set via wp-config NFD_EDITOR_CHAT_MODEL.
	const model = options.model || window.nfdEditorChat?.model || undefined;

	// Captured now: by the time this stream ends the ref may hold a newer turn's
	// controller, which would report "not aborted" for work this turn started.
	const signal = abortControllerRef.current?.signal;

	if (signal?.aborted) {
		throw createAbortError();
	}

	const stream = await client.chat.completions.create(
		{
			model,
			messages: msgs,
			tools: tools.length > 0 ? tools : undefined,
			tool_choice: tools.length > 0 ? "auto" : undefined,
			stream: true,
			stream_options: { include_usage: true },
			temperature: options.temperature ?? 0.7,
			max_completion_tokens: options.max_completion_tokens ?? MAX_COMPLETION_TOKENS,
		},
		{ signal }
	);

	let fullMessage = "";
	let displayMessage = "";
	let finishReason = null;
	const toolCallsInProgress = {};

	// Batch in-place message updates to one paint per frame.
	let streamUiRafId = null;
	const scheduleStreamUpsert = () => {
		if (!setMessages || !streamMessageId || options.silent || !displayMessage) {
			return;
		}
		if (streamUiRafId === null) {
			streamUiRafId = window.requestAnimationFrame(() => {
				streamUiRafId = null;
				upsertStreamingMessage(setMessages, streamMessageId, displayMessage);
			});
		}
	};
	const flushStreamUiNow = () => {
		if (streamUiRafId !== null) {
			window.cancelAnimationFrame(streamUiRafId);
			streamUiRafId = null;
		}
		if (setMessages && streamMessageId && displayMessage && !options.silent) {
			upsertStreamingMessage(setMessages, streamMessageId, displayMessage);
		}
	};

	const appendDisplayText = (text) => {
		if (!text) {
			return;
		}
		displayMessage += text;
		scheduleStreamUpsert();
	};

	// Prefix stripping: buffer early chars to hide [PLAN] from the UI
	const stripPrefix = options.stripPrefix || null;
	let prefixBuffer = "";
	let prefixResolved = !stripPrefix; // skip buffering if no prefix to strip
	let needsTrimStart = false; // trim leading space on first chunk after prefix resolution

	for await (const chunk of stream) {
		const delta = chunk.choices?.[0]?.delta;
		if (!delta) {
			// Usage-only chunk or empty
			if (chunk.usage) {
				logger.log(
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

			// Structured JSON mode: the model emits {"message":"…"} first and its
			// tool calls after. Render the message field as it streams instead of
			// waiting for the whole response: on a whole-page edit the tool
			// arguments are tens of thousands of tokens, so withholding everything
			// leaves the user watching a frozen indicator for the entire
			// generation even though the plan was ready in the first second.
			if (options.jsonMessageDisplay) {
				const partial = partialJsonMessage(fullMessage);
				if (partial !== null && partial !== displayMessage) {
					displayMessage = partial;
					scheduleStreamUpsert();
				}
				continue;
			}

			if (!prefixResolved) {
				prefixBuffer += delta.content;
				if (prefixBuffer.length >= stripPrefix.length) {
					prefixResolved = true;
					if (prefixBuffer.startsWith(stripPrefix)) {
						// Strip prefix, stream the remainder (trim leading space left by "[PLAN] …")
						needsTrimStart = true;
						const remainder = prefixBuffer.slice(stripPrefix.length).trimStart();
						if (remainder) {
							needsTrimStart = false;
							appendDisplayText(remainder);
						}
					} else {
						// Not a match, flush entire buffer
						appendDisplayText(prefixBuffer);
					}
				}
				// Still buffering — don't update UI yet
			} else {
				// Strip duplicate [PLAN] markers and tool-call leakage from streaming display
				let cleaned = stripPrefix
					? delta.content.replace(/\[PLAN\]/g, "").replace(/=fn\.\S*/g, "")
					: delta.content;
				if (needsTrimStart) {
					cleaned = cleaned.trimStart();
					needsTrimStart = false;
				}
				appendDisplayText(cleaned);
			}
		}

		// Tool call deltas
		if (delta.tool_calls) {
			for (let i = 0; i < delta.tool_calls.length; i++) {
				const toolCall = delta.tool_calls[i];
				const index = toolCall.index ?? toolCall.id ?? i;
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

	// The SDK ends the iterator without throwing on abort, so a stopped stream
	// looks complete but carries partial tool calls. Surface it as a real abort.
	if (signal?.aborted) {
		window.cancelAnimationFrame(streamUiRafId);
		throw createAbortError();
	}

	// Flush any unresolved prefix buffer (response shorter than prefix length)
	if (!prefixResolved && prefixBuffer && !options.jsonMessageDisplay) {
		appendDisplayText(prefixBuffer);
	}

	// Structured JSON responses: show only the "message" field, not raw JSON
	if (options.jsonMessageDisplay && fullMessage && !options.silent) {
		displayMessage = getAssistantDisplayMessage(fullMessage);
	}

	flushStreamUiNow();

	// Controller is deliberately not cleared — tool execution runs after this
	// returns and Stop needs it live until the turn ends.

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
