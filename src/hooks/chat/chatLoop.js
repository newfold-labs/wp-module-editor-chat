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
	createRetryTracker,
} from "./conversationUtils";
import {
	ASSISTANT_JSON_FORMAT,
	EXECUTE_NUDGE,
	SUMMARIZE_NUDGE,
	PRESENT_PALETTE_OPTIONS_NUDGE,
	buildCreationSummarizeNudge,
	buildEditorContext,
	buildRemainingStepsNudge,
} from "../../utils/editorContext";
import { executeToolCallsForREST } from "../../services/toolDispatcher";
import { appendCreationLinkIfNeeded } from "../../services/contentNavigation";
import {
	classifyUserIntent as classifyUserIntentDefault,
	intentNeedsAllTools,
	getIntentNudge,
	DEFAULT_INTENT,
} from "../../services/intentClassifier";
import { restoreAnimatedBlocksInEditor } from "../../utils/editorUtils";
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
 * Select tools for a pass based on classified user intent.
 *
 * @param {Object} intent      Classified intent for this turn
 * @param {Array}  openaiTools All available MCP tools
 * @return {Array} Tools to send to the model for this intent
 */
function getToolsForIntent(intent, openaiTools) {
	if (intentNeedsAllTools(intent)) {
		return openaiTools;
	}
	if (intent?.task === "conversational" && !intent?.steps?.length) {
		return [];
	}
	return openaiTools.filter((t) => EDITOR_TOOLS.has(t.function.name));
}

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
		pendingIntentRef,
		setMessages,
		setStatus,
		openaiTools,
		streamCompletion,
		buildToolCtx,
		abortControllerRef,
		displayMessage = userMessage,
		attachments = [],
		getSessionConfig,
		classifyUserIntent = classifyUserIntentDefault,
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

	// Add user message to display — use displayMessage (original instruction) not
	// the enriched API message which may contain injected context like [Image edit request].
	const ts = Date.now();
	setMessages((prev) => [
		...prev,
		{
			id: `user-${ts}`,
			type: "user",
			role: "user",
			content: displayMessage,
			// Allegati immagine (solo con URL server) mostrati nella bolla utente.
			...(Array.isArray(attachments) && attachments.length > 0 ? { attachments } : {}),
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
	// Steps for a multi-part request, from the intent classifier. Empty, or 2+.
	// While steps remain the turn keeps going instead of summarizing after the
	// first tool round and dropping the rest of the request.
	let plannedSteps = [];
	// Tool rounds that changed something — N steps never need more than N.
	let writeRounds = 0;
	// One corrective pass per turn when the model signs off with steps unapplied.
	let unfinishedNudgeUsed = false;
	// True once the model has emitted a final tool-free reply for this turn.
	let endedNaturally = false;
	// True if the user stopped generation mid-turn (suppresses the closing pass).
	let userAborted = false;
	const retryTracker = createRetryTracker();
	const extraClientIds = [];
	const markupRequestCount = { current: 0 };
	let markupJustProvided = false;
	let paletteOptionsJustGenerated = false;
	let lastCreationOutcome = null;
	// Whether any tool actually changed something this turn (across all passes).
	// Distinct from `toolsJustExecuted`, which is reset/recomputed each pass.
	let anyMutationThisTurn = false;
	const intentMessage = displayMessage || userMessage;
	let menuDeleteDone = false;
	let menuLinkConfigured = false;
	let menuIncompleteNudges = 0;

	setStatus(CHAT_STATUS.GENERATING);
	const sessionConfig = getSessionConfig?.() || null;

	// If the previous turn proposed an actionable change but ended without
	// executing it (e.g. "Shall I apply this palette?"), reuse that intent for
	// this turn instead of re-classifying. A short confirmation like "yes" is
	// ambiguous in isolation and the classifier reasonably calls it
	// `conversational`, which would otherwise strip every tool from this pass
	// and leave the AI unable to actually do what it just offered to do.
	// Consumed exactly once so it can't leak into unrelated later turns.
	let intent;
	let usedPendingIntent = false;
	if (pendingIntentRef?.current) {
		intent = pendingIntentRef.current;
		pendingIntentRef.current = null;
		usedPendingIntent = true;
		logger.log("[EditorChat] Reusing pending intent from prior proposal:", intent.task);
	} else {
		intent = sessionConfig
			? await classifyUserIntent(intentMessage, sessionConfig)
			: DEFAULT_INTENT;
	}
	const menuEdit = intent.menu_edit;
	const menuEditRequested = menuEdit?.requested === true;
	const wantsMenuAdd = menuEdit?.add === true;
	const wantsMenuRemove = menuEdit?.remove === true;
	logger.log(
		"[EditorChat] User intent:",
		intent.task,
		intent.content_type,
		intent.menu_edit,
		intent.steps
	);
	if (intent.steps?.length > 1) {
		plannedSteps = intent.steps;
		logger.log("[EditorChat] Multi-step request:", plannedSteps);
	}

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
		// Tool set is driven by LLM intent classification (multilingual, synonym-safe).
		const toolsForPass = getToolsForIntent(intent, openaiTools);

		let nudge;
		if (toolsJustExecuted) {
			if (lastCreationOutcome) {
				nudge = buildCreationSummarizeNudge(lastCreationOutcome);
			} else if (writeRounds < plannedSteps.length) {
				nudge = buildRemainingStepsNudge(plannedSteps.slice(writeRounds));
			} else {
				nudge = SUMMARIZE_NUDGE;
			}
		} else if (markupJustProvided) {
			nudge = MARKUP_PROVIDED_NUDGE;
			markupJustProvided = false;
		} else if (paletteOptionsJustGenerated) {
			nudge = PRESENT_PALETTE_OPTIONS_NUDGE;
			paletteOptionsJustGenerated = false;
		} else {
			nudge = getIntentNudge(intent, EXECUTE_NUDGE, ASSISTANT_JSON_FORMAT);
		}
		toolsJustExecuted = false;

		const intentBlock = `<user_intent>\n${JSON.stringify(intent)}\n</user_intent>`;
		const toolMessages = [
			...conversationHistoryRef.current,
			{
				role: "user",
				content: editorContextMsg.content + "\n\n" + intentBlock + "\n\n" + nudge,
			},
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

		const parsed = parseAssistantResponse(content);
		const assistantDisplayMessage = parsed?.message || content || "";

		if (!toolCalls || toolCalls.length === 0) {
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

			const menuStillIncomplete =
				menuEditRequested &&
				((wantsMenuRemove && !menuDeleteDone) || (wantsMenuAdd && !menuLinkConfigured));

			if (menuStillIncomplete && menuIncompleteNudges < 2 && iterations < MAX_TOOL_ITERATIONS) {
				menuIncompleteNudges++;
				conversationHistoryRef.current.push({ role: "assistant", content });
				removeStreamingMessage(setMessages, streamMessageId);
				let detail =
					"MENU EDIT INCOMPLETE: You must finish the menu edit with write tools before confirming.";
				if (wantsMenuRemove && !menuDeleteDone) {
					detail +=
						' Call blu-delete-block with { label: "<item label>" } e.g. { label: "Our Story" }. Do not reuse client_ids from the block tree — they are stale after menu edits.';
				}
				if (wantsMenuAdd && !menuLinkConfigured) {
					detail +=
						" Add the page with blu-insert-inner-block on the core/navigation block (linked-menu): pass a navigation-link block with label, type page, id from pages-search, kind post-type — no url. If insert reports already_present, still complete any remove step. Do not duplicate then patch.";
				}
				conversationHistoryRef.current.push({
					role: "system",
					content: detail,
				});
				readOnlyStreak = 0;
				continue;
			}

			// Signing off with planned work unapplied — this is where the model tells
			// the user it added two services it never created. One corrective pass.
			if (!unfinishedNudgeUsed && writeRounds < plannedSteps.length) {
				unfinishedNudgeUsed = true;
				conversationHistoryRef.current.push({ role: "assistant", content });
				removeStreamingMessage(setMessages, streamMessageId);
				conversationHistoryRef.current.push({
					role: "system",
					content: buildRemainingStepsNudge(plannedSteps.slice(writeRounds)),
				});
				readOnlyStreak = 0;
				logger.log(
					`[EditorChat] ${plannedSteps.length - writeRounds} step(s) unapplied — prompting once more`
				);
				continue;
			}

			conversationHistoryRef.current.push({
				role: "assistant",
				content,
			});
			const finalDisplay = lastCreationOutcome
				? appendCreationLinkIfNeeded(assistantDisplayMessage, lastCreationOutcome)
				: assistantDisplayMessage;
			finalizeStreamingMessage(setMessages, streamMessageId, finalDisplay);
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
			const envelope =
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
				name: envelope.ability_name || tc.name,
				arguments: envelope.parameters || {},
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
		if (assistantDisplayMessage && !planShown) {
			planShown = true;
			finalizeStreamingMessage(setMessages, streamMessageId, assistantDisplayMessage);
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
		lastCreationOutcome = results.find((r) => r.creationMeta)?.creationMeta ?? null;
		toolsJustExecuted = results.some((r) => r.hasChanges === true || r.isContentCreation === true);
		anyMutationThisTurn = anyMutationThisTurn || toolsJustExecuted;
		// blu-generate-color-palette returns option(s) to choose from, not a
		// change already applied — the default brief-confirmation nudges would
		// otherwise make the model announce "N options" without listing them.
		paletteOptionsJustGenerated = results.some((r) => {
			const name = effectiveName.get(r.tool_call_id) || "";
			return name === "blu-generate-color-palette" && !r.isError;
		});
		if (menuEditRequested) {
			for (const uc of unwrappedCalls) {
				const toolName = (uc.name || "").replace(/\//g, "-");
				const matched = results.find((r) => r.tool_call_id === uc.id);
				if (!matched || matched.isError || !matched.hasChanges) {
					continue;
				}
				if (toolName === "blu-delete-block") {
					menuDeleteDone = true;
				}
				if (toolName === "blu-update-block-attrs") {
					const args =
						typeof uc.arguments === "object" && uc.arguments !== null ? uc.arguments : {};
					const attrs = args.attributes || args;
					if (attrs.id || (attrs.type && attrs.label)) {
						menuLinkConfigured = true;
					}
				}
				if (toolName === "blu-insert-inner-block") {
					menuLinkConfigured = true;
				}
			}
		}
		if (toolsJustExecuted) {
			writeRounds++;
			restoreAnimatedBlocksInEditor();
		}

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

	// Arm the pending-intent carry-over for the next turn when this one proposed
	// an actionable change but never executed it (a pure text reply/question).
	// Any non-conversational task qualifies here, not just
	// intentNeedsAllTools() (create_content/site_management) — edit_page is the
	// common default classification and its tool set (EDITOR_TOOLS) is what
	// let this turn call blu-generate-color-palette etc. in the first place, so
	// it must carry forward too, or a short confirmation next turn falls back
	// to a fresh (likely `conversational`, zero-tool) classification.
	// Skip re-arming when this turn itself was a reused pending intent, so the
	// carry-over can't chain past one hop into unrelated later turns.
	if (
		pendingIntentRef &&
		!usedPendingIntent &&
		!anyMutationThisTurn &&
		intent?.task !== "conversational"
	) {
		pendingIntentRef.current = intent;
	}

	// Compress older exchanges to keep history lean for next turn
	conversationHistoryRef.current = compressConversationHistory(conversationHistoryRef.current);
}
