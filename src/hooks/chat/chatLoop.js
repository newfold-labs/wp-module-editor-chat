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
	REASONING_INSTRUCTION,
	EXECUTE_NUDGE,
	SUMMARIZE_NUDGE,
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

	// First message: reset conversation history (system prompt is injected by the worker)
	if (isFirstMessageRef.current) {
		conversationHistoryRef.current = [];
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
	let toolsJustExecuted = false;
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

			const reasoningStart = performance.now();
			const { content: rawReasoning } = await streamCompletion(reasoningMessages, [], {
				max_completion_tokens: 200,
				stripPrefix: "[PLAN]",
			});
			console.debug(
				`[EditorChat] Reasoning pass: ${(performance.now() - reasoningStart).toFixed(0)}ms`
			);

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
					id: `assistant-${ts}-${msgSeq++}-reasoning`,
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

		// Editor context + nudge injected per-request, NOT persisted.
		// Use "user" role so the conversation ends on a user turn (see reasoning pass comment).
		// After tools have run, use SUMMARIZE_NUDGE so the AI confirms instead of re-executing.
		const nudge = toolsJustExecuted ? SUMMARIZE_NUDGE : EXECUTE_NUDGE;
		toolsJustExecuted = false;
		const toolMessages = [
			...conversationHistoryRef.current,
			{ role: "user", content: editorContextMsg.content + "\n\n" + nudge },
		];

		const toolPassStart = performance.now();
		const { content, toolCalls } = await streamCompletion(toolMessages, toolsForPass, {
			silent: true,
		});
		console.debug(
			`[EditorChat] Tool pass #${iterations} LLM: ${(performance.now() - toolPassStart).toFixed(0)}ms (${toolCalls?.length || 0} tool calls)`
		);

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

		// Retry detection — the tracker hashes (name, arguments) pairs, so it
		// must see the real ability name AND the real arguments, not the
		// gateway dispatcher's envelope. Unwrap blu-call-ability into the
		// logical call the model conceptually made.
		const unwrappedCalls = toolCalls.map((tc) => {
			if (tc.name !== "blu-call-ability") return { ...tc };
			const parsed =
				typeof tc.arguments === "string"
					? (() => {
							try {
								return JSON.parse(tc.arguments);
							} catch {
								return {};
							}
						})()
					: tc.arguments || {};
			return {
				...tc,
				name: parsed.ability_name || tc.name,
				arguments: parsed.parameters || {},
			};
		});
		const { allRetried, retryLimitHit } = retryTracker.recordIteration(unwrappedCalls);

		if (allRetried) {
			if (retryLimitHit) {
				// Second trigger → stop immediately
				console.warn("[EditorChat] Retry loop — breaking (AI ignored RETRY LIMIT)");
				break;
			}
			console.warn(
				"[EditorChat] Retry loop detected — identical (tool, args) repeated",
				unwrappedCalls.map((tc) => tc.name)
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
		const toolExecStart = performance.now();
		const results =
			executableCalls.length > 0
				? await executeToolCallsForREST(executableCalls, buildToolCtx())
				: [];
		if (executableCalls.length > 0) {
			console.debug(
				`[EditorChat] Tool exec #${iterations}: ${(performance.now() - toolExecStart).toFixed(0)}ms (${executableCalls.length} tools)`
			);
		}

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
				content: "All tool calls above succeeded.",
			});
		}

		// Only switch to SUMMARIZE_NUDGE when at least one tool actually changed
		// something. If the round was purely discovery (get-ability-schema,
		// get-block-markup, etc.) we must keep nudging EXECUTE — otherwise the
		// next iteration tells the AI "all changes are applied" and it replies
		// with a confirmation without ever running the write tool.
		toolsJustExecuted = results.some((r) => r.hasChanges === true);
		setStatus(CHAT_STATUS.SUMMARIZING);
		// Loop continues — next iteration will get the AI's response
	}

	// Compress older exchanges to keep history lean for next turn
	conversationHistoryRef.current = compressConversationHistory(conversationHistoryRef.current);
}
