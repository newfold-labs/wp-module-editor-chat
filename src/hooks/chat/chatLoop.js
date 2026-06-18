/**
 * chatLoop — The function-calling loop for editor chat.
 *
 * Plain async function (no React hooks). Single-pass function-calling: the
 * model emits a brief natural-language plan and tool_calls in the same
 * response. Handles retry detection, tool execution, and history compression.
 * The orchestrator wraps this in useCallback and handles try/catch/finally.
 */
import {
	CHAT_STATUS,
	EDITOR_TOOLS,
	MAX_TOOL_ITERATIONS,
	MAX_READ_ONLY_PASSES,
	MAX_READ_RESULT_CHARS,
	READ_ONLY_TOOLS,
} from "./constants";
import {
	truncateToolResult,
	compressConversationHistory,
	messageNeedsSiteTools,
	createRetryTracker,
} from "./conversationUtils";
import { EXECUTE_NUDGE, SUMMARIZE_NUDGE, buildEditorContext } from "../../utils/editorContext";
import { executeToolCallsForREST } from "../../services/toolDispatcher";
import { finalizeStreamingMessage, removeStreamingMessage } from "./streamMessageHelpers";
import {
	MARKUP_PROVIDED_NUDGE,
	parseAssistantResponse,
	getAssistantDisplayMessage,
	canRequestBlockMarkup,
	filterValidMarkupClientIds,
	MAX_MARKUP_REQUESTS_PER_TURN,
} from "./assistantResponse";
import logger from "../../utils/logger";

/**
 * Stable ids for the two assistant slots in a turn (plan preamble vs final reply).
 * @param {number} ts Turn timestamp
 */
const planStreamId = (ts) => `assistant-${ts}-plan`;
const replyStreamId = (ts) => `assistant-${ts}-reply`;
const closingStreamId = (ts) => `assistant-${ts}-closing`;

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

	// Single-pass function-calling loop — no separate reasoning pass.
	let iterations = 0;
	let toolsJustExecuted = false;
	// Whether we've already surfaced a plan preamble for this turn. The model is
	// nudged to restate "I'll do X" before every tool pass, so a multi-pass turn
	// (e.g. read → edit) emits the same sentence repeatedly. Show the first one as
	// the preamble and suppress the rest; the final tool-free reply still shows.
	let planShown = false;
	// Consecutive passes that only gathered info (read-only tools, no change).
	let readOnlyStreak = 0;
	// True once the model has emitted a final tool-free reply for this turn.
	let endedNaturally = false;
	// True if the user stopped generation mid-turn (suppresses the closing pass).
	let userAborted = false;
	const retryTracker = createRetryTracker();
	const extraClientIds = [];
	const markupRequestCount = { current: 0 };
	let markupJustProvided = false;

	while (iterations++ < MAX_TOOL_ITERATIONS) {
		// Check if user aborted between iterations (e.g. during tool execution)
		if (abortControllerRef?.current?.signal?.aborted) {
			userAborted = true;
			break;
		}

		// Fresh editor context each iteration (reflects tool changes)
		const editorContext = buildEditorContext({ extraClientIds });
		const editorContextMsg = {
			role: "system",
			content: `<editor_context>\n${editorContext}\n</editor_context>`,
		};

		setStatus(CHAT_STATUS.GENERATING);

		const streamMessageId = planShown ? replyStreamId(ts) : planStreamId(ts);

		// ── Tool-calling pass ──
		// Dynamically select tools based on the user's message:
		// editor tasks → only block-editing tools (prevents search-media, get-function-details, etc.)
		// site management tasks (create post, upload media, etc.) → all tools
		const toolsForPass = messageNeedsSiteTools(userMessage)
			? openaiTools
			: openaiTools.filter((t) => EDITOR_TOOLS.has(t.function.name));

		let nudge;
		if (toolsJustExecuted) {
			nudge = SUMMARIZE_NUDGE;
		} else if (markupJustProvided) {
			nudge = MARKUP_PROVIDED_NUDGE;
			markupJustProvided = false;
		} else {
			nudge = EXECUTE_NUDGE;
		}
		toolsJustExecuted = false;

		const toolMessages = [
			...conversationHistoryRef.current,
			{ role: "user", content: editorContextMsg.content + "\n\n" + nudge },
		];

		const toolPassStart = performance.now();
		const { content, toolCalls } = await streamCompletion(toolMessages, toolsForPass, {
			resetStream: planShown,
			streamMessageId,
			jsonMessageDisplay: true,
		});
		logger.log(
			`[EditorChat] Tool pass #${iterations} LLM: ${(performance.now() - toolPassStart).toFixed(0)}ms (${toolCalls?.length || 0} tool calls)`
		);

		const displayMessage = getAssistantDisplayMessage(content);

		if (!toolCalls || toolCalls.length === 0) {
			const parsed = parseAssistantResponse(content);
			if (
				parsed?.need_blocks_markup?.length &&
				canRequestBlockMarkup() &&
				markupRequestCount.current < MAX_MARKUP_REQUESTS_PER_TURN
			) {
				markupRequestCount.current++;
				conversationHistoryRef.current.push({ role: "assistant", content });
				removeStreamingMessage(setMessages, streamMessageId);

				const validIds = filterValidMarkupClientIds(parsed.need_blocks_markup);
				if (validIds.length > 0) {
					for (const id of validIds) {
						if (!extraClientIds.includes(id)) {
							extraClientIds.push(id);
						}
					}
					conversationHistoryRef.current.push({
						role: "system",
						content: `Block markup for client_ids [${validIds.join(", ")}] is included in the next editor_context.`,
					});
					markupJustProvided = true;
					readOnlyStreak = 0;
					logger.log("[EditorChat] need_blocks_markup honored", validIds);
					continue;
				}

				conversationHistoryRef.current.push({
					role: "system",
					content:
						"ERROR: need_blocks_markup client_ids were not found in the block tree. Use exact ids from the block tree, or call blu-get-block-markup instead.",
				});
				readOnlyStreak = 0;
				continue;
			}

			conversationHistoryRef.current.push({
				role: "assistant",
				content,
			});
			finalizeStreamingMessage(setMessages, streamMessageId, displayMessage);
			endedNaturally = true;
			break;
		}

		// Tool calls — execute them
		setStatus(CHAT_STATUS.TOOL_CALL);

		// Retry detection — the tracker hashes (name, arguments) pairs, so it
		// must see the real ability name AND the real arguments, not the
		// gateway dispatcher's envelope. Unwrap blu-call-ability into the
		// logical call the model conceptually made.
		const unwrappedCalls = toolCalls.map((tc) => {
			if (tc.name !== "blu-call-ability") {
				return { ...tc };
			}
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

		// Surface the inline plan text (emitted before the tool_calls) as a visible
		// message — but only the FIRST one per turn. Subsequent passes restate the
		// same intent ("I'll update the colors…" again), which reads as duplicate
		// messages. The plan still goes into conversation history above so the model
		// keeps its own context; we just don't render the repeat.
		if (displayMessage && !planShown) {
			planShown = true;
			finalizeStreamingMessage(setMessages, streamMessageId, displayMessage);
		} else {
			// Repeat preamble or empty plan — drop the in-progress stream row.
			removeStreamingMessage(setMessages, streamMessageId);
		}

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
			logger.log(
				`[EditorChat] Tool exec #${iterations}: ${(performance.now() - toolExecStart).toFixed(0)}ms (${executableCalls.length} tools)`
			);
		}

		// Append tool results to conversation. Budget by tool kind, keyed off the
		// UNWRAPPED ability name (toolCalls carry the `blu-call-ability` envelope):
		//   - Discovery (list-abilities, get-ability-schema): never truncate — the
		//     full output is what lets the model find and call abilities.
		//   - Other read-only tools (get-block-markup, get-global-styles, …): keep a
		//     generous budget. These return the data the model reasons over; cutting
		//     them to the write-ack default is what makes it re-read and loop.
		//   - Write tools: short ack, the default truncation is plenty.
		const DISCOVERY_TOOLS = new Set(["blu-list-abilities", "blu-get-ability-schema"]);
		const effectiveName = new Map(
			unwrappedCalls.map((tc) => [tc.id, (tc.name || "").replace(/\//g, "-")])
		);
		for (const r of results) {
			const rawContent = typeof r.content === "string" ? r.content : JSON.stringify(r.content);
			const name = effectiveName.get(r.tool_call_id) || "";
			let resultContent;
			if (DISCOVERY_TOOLS.has(name)) {
				resultContent = rawContent;
			} else if (READ_ONLY_TOOLS.has(name)) {
				resultContent = truncateToolResult(rawContent, MAX_READ_RESULT_CHARS);
			} else {
				resultContent = truncateToolResult(rawContent);
			}
			conversationHistoryRef.current.push({
				role: "tool",
				tool_call_id: r.tool_call_id,
				content: resultContent,
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

		// No-progress guard. The retry tracker exempts read-only tools, so a model
		// that keeps re-reading (get-block-markup, get-ability-schema, …) without
		// ever editing would otherwise spin until MAX_TOOL_ITERATIONS and exit with
		// no reply. Count consecutive info-only passes (read-only tools, nothing
		// changed); once it's clearly circling, stop — the post-loop closing pass
		// turns that into a real answer instead of a wall of repeated reasoning.
		const infoOnlyPass =
			unwrappedCalls.length > 0 &&
			!toolsJustExecuted &&
			unwrappedCalls.every((tc) => READ_ONLY_TOOLS.has((tc.name || "").replace(/\//g, "-")));
		readOnlyStreak = infoOnlyPass ? readOnlyStreak + 1 : 0;
		if (readOnlyStreak >= MAX_READ_ONLY_PASSES) {
			console.warn(
				`[EditorChat] No-progress loop: ${readOnlyStreak} read-only passes with no change — stopping to summarize`
			);
			break;
		}

		setStatus(CHAT_STATUS.SUMMARIZING);
		// Loop continues — next iteration will get the AI's response
	}

	// Closing pass. If we exited mid-task — hit the iteration ceiling, broke a
	// retry/read loop, or the model never produced a final reply — the user is
	// left with dangling reasoning and no answer. Make one tool-free pass so the
	// turn ends with a coherent response (or a clear "here's what I need").
	if (!endedNaturally && !userAborted && !abortControllerRef?.current?.signal?.aborted) {
		setStatus(CHAT_STATUS.SUMMARIZING);
		const closingId = closingStreamId(ts);
		const closingContext = buildEditorContext({ extraClientIds });
		const closingMessages = [
			...conversationHistoryRef.current,
			{
				role: "user",
				content: `<editor_context>\n${closingContext}\n</editor_context>\n\n${SUMMARIZE_NUDGE}`,
			},
		];
		const { content: closing } = await streamCompletion(closingMessages, [], {
			resetStream: true,
			streamMessageId: closingId,
			jsonMessageDisplay: true,
		});
		const closingDisplay = getAssistantDisplayMessage(closing);
		if (closingDisplay && closingDisplay.trim()) {
			conversationHistoryRef.current.push({ role: "assistant", content: closing });
			finalizeStreamingMessage(setMessages, closingId, closingDisplay);
		} else {
			removeStreamingMessage(setMessages, closingId);
		}
	}

	// Compress older exchanges to keep history lean for next turn
	conversationHistoryRef.current = compressConversationHistory(conversationHistoryRef.current);
}
