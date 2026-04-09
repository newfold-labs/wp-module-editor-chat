/* eslint-disable no-console */
/**
 * chatLoop — The function-calling loop for editor chat.
 *
 * Plain async function (no React hooks). Handles reasoning pass,
 * tool selection, retry detection, tool execution, and history compression.
 * The orchestrator wraps this in useCallback and handles try/catch/finally.
 */
import { CHAT_STATUS, EDITOR_TOOLS, MAX_TOOL_ITERATIONS } from "./constants";
import {
	parseReasoningResponse,
	truncateToolResult,
	compressConversationHistory,
	messageNeedsSiteTools,
	createRetryTracker,
} from "./conversationUtils";
import {
	EDITOR_SYSTEM_PROMPT,
	REASONING_INSTRUCTION,
	EXECUTE_NUDGE,
	buildEditorContext,
} from "../../utils/editorContext";
import { executeToolCallsForREST } from "../../services/toolExecutor";

/**
 * Run the function-calling loop for a single user message.
 *
 * @param {string} userMessage The user's message content
 * @param {Object} deps        All dependencies (refs, setters, functions)
 */
export async function runChatLoop(userMessage, deps) {
	const {
		conversationHistoryRef,
		isFirstMessageRef,
		setMessages,
		setStatus,
		setCurrentResponse,
		openaiTools,
		streamCompletion,
		buildToolCtx,
		abortControllerRef,
	} = deps;

	// First message: include system prompt
	if (isFirstMessageRef.current) {
		conversationHistoryRef.current = [{ role: "system", content: EDITOR_SYSTEM_PROMPT }];
		isFirstMessageRef.current = false;
	}

	// Store clean user message — editor context is injected per-request, not persisted
	conversationHistoryRef.current.push({
		role: "user",
		content: userMessage,
	});

	// Add clean user message to display
	const ts = Date.now();
	setMessages((prev) => [
		...prev,
		{
			id: `user-${ts}`,
			type: "user",
			role: "user",
			content: userMessage,
			timestamp: new Date(),
		},
	]);

	// Function calling loop with reasoning first-pass
	let iterations = 0;
	let isReasoningPass = true;
	let msgSeq = 0;
	const retryTracker = createRetryTracker();

	while (iterations++ < MAX_TOOL_ITERATIONS) {
		// Check if user aborted between iterations (e.g. during tool execution)
		if (abortControllerRef?.current?.signal?.aborted) {
			break;
		}

		// Fresh editor context each iteration (reflects tool changes)
		const editorContext = buildEditorContext();
		const editorContextMsg = {
			role: "system",
			content: `<editor_context>\n${editorContext}\n</editor_context>`,
		};

		setStatus(CHAT_STATUS.GENERATING);
		setCurrentResponse("");

		if (isReasoningPass) {
			// ── Pass 1: reasoning call — no tools, [PLAN] prefix stripped ──
			isReasoningPass = false;

			// Use "user" role for injected context so the conversation always ends
			// on a user turn. Some providers (e.g. Anthropic via OpenRouter) strip
			// system messages, which can leave an assistant message last → prefill error.
			const reasoningMessages = [
				...conversationHistoryRef.current,
				{ role: "user", content: editorContextMsg.content + "\n\n" + REASONING_INSTRUCTION },
			];

			const { content: rawReasoning } = await streamCompletion(reasoningMessages, [], {
				max_completion_tokens: 200,
				stripPrefix: "[PLAN]",
			});

			const { isPlan, content: reasoning } = parseReasoningResponse(rawReasoning);

			if (!isPlan) {
				// Conversational response — final answer, no tools needed
				conversationHistoryRef.current.push({
					role: "assistant",
					content: reasoning,
				});
				setCurrentResponse("");
				setMessages((prev) => [
					...prev,
					{
						id: `assistant-${ts}-${msgSeq++}`,
						type: "assistant",
						role: "assistant",
						content: reasoning,
						timestamp: new Date(),
					},
				]);
				break;
			}

			// It's a plan — persist reasoning as a visible message
			conversationHistoryRef.current.push({
				role: "assistant",
				content: reasoning,
			});
			setCurrentResponse("");
			setMessages((prev) => [
				...prev,
				{
					id: `assistant-${ts}-${msgSeq++}`,
					type: "assistant",
					role: "assistant",
					content: reasoning,
					timestamp: new Date(),
				},
			]);

			// Continue to next iteration which will call with tools
			continue;
		}

		// ── Pass 2+: call with tools ──
		// Dynamically select tools based on the user's message:
		// editor tasks → only block-editing tools (prevents search-media, get-function-details, etc.)
		// site management tasks (create post, upload media, etc.) → all tools
		const toolsForPass = messageNeedsSiteTools(userMessage)
			? openaiTools
			: openaiTools.filter((t) => EDITOR_TOOLS.has(t.function.name));

		// Editor context + execute nudge injected per-request, NOT persisted.
		// Use "user" role so the conversation ends on a user turn (see reasoning pass comment).
		const toolMessages = [
			...conversationHistoryRef.current,
			{ role: "user", content: editorContextMsg.content + "\n\n" + EXECUTE_NUDGE },
		];

		const { content, toolCalls } = await streamCompletion(toolMessages, toolsForPass, {
			silent: true,
		});

		if (!toolCalls || toolCalls.length === 0) {
			// Final response — no more tools
			conversationHistoryRef.current.push({
				role: "assistant",
				content,
			});
			setCurrentResponse("");
			setMessages((prev) => [
				...prev,
				{
					id: `assistant-${ts}-${msgSeq++}`,
					type: "assistant",
					role: "assistant",
					content,
					timestamp: new Date(),
				},
			]);
			break;
		}

		// Tool calls — execute them
		setCurrentResponse("");
		setStatus(CHAT_STATUS.TOOL_CALL);

		// Retry detection
		const { allRetried, retryLimitHit } = retryTracker.recordIteration(toolCalls);

		if (allRetried) {
			if (retryLimitHit) {
				// Second trigger → stop immediately
				console.warn("[EditorChat] Retry loop — breaking (AI ignored RETRY LIMIT)");
				break;
			}
			console.warn(
				"[EditorChat] Retry loop detected — all tool calls have been repeated",
				toolCalls.map((tc) => `${tc.name}`)
			);
			// Append the assistant message so the conversation stays valid
			conversationHistoryRef.current.push({
				role: "assistant",
				content: content || null,
				tool_calls: toolCalls.map((tc) => ({
					id: tc.id,
					type: "function",
					function: {
						name: tc.name,
						arguments:
							typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
					},
				})),
			});
			// Inject synthetic tool results — give AI one chance to summarize
			for (const tc of toolCalls) {
				conversationHistoryRef.current.push({
					role: "tool",
					tool_call_id: tc.id,
					content:
						"RETRY LIMIT: This tool has already been called multiple times. The edit is already applied. Do NOT call any more tools — respond to the user with a brief summary.",
				});
			}
			continue;
		}

		// Append assistant message with tool_calls to conversation
		conversationHistoryRef.current.push({
			role: "assistant",
			content: content || null,
			tool_calls: toolCalls.map((tc) => ({
				id: tc.id,
				type: "function",
				function: {
					name: tc.name,
					arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments),
				},
			})),
		});

		// Handle truncated tool calls — skip execution, return error
		const truncated = toolCalls.filter((tc) => tc._truncated);
		if (truncated.length > 0) {
			for (const tc of truncated) {
				conversationHistoryRef.current.push({
					role: "tool",
					tool_call_id: tc.id,
					content:
						"ERROR: Tool arguments were truncated and could not be parsed. Try again with shorter content or fewer changes at once.",
				});
			}
		}

		// Execute non-truncated tools only
		const executableCalls = toolCalls.filter((tc) => !tc._truncated);
		const results =
			executableCalls.length > 0
				? await executeToolCallsForREST(executableCalls, buildToolCtx())
				: [];

		// Append tool results to conversation (truncated to limit token growth)
		for (const r of results) {
			const rawContent = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
			conversationHistoryRef.current.push({
				role: "tool",
				tool_call_id: r.tool_call_id,
				content: truncateToolResult(rawContent),
			});
		}

		// If all tools succeeded, nudge the AI to summarize rather than retry.
		// The AI can still chain different tools if needed (e.g., generate-image
		// then update-block-attrs) — it just shouldn't repeat the same operation.
		const allSucceeded = results.every((r) => !r.isError);
		if (allSucceeded && results.length > 0) {
			conversationHistoryRef.current.push({
				role: "system",
				content:
					"All actions completed successfully. If the user's request is fully handled, respond with a brief summary. Only call more tools if additional DIFFERENT steps are needed to complete the request.",
			});
		}

		setStatus(CHAT_STATUS.SUMMARIZING);
		// Loop continues — next iteration will get the AI's response
	}

	// Compress older exchanges to keep history lean for next turn
	conversationHistoryRef.current = compressConversationHistory(conversationHistoryRef.current);
}
