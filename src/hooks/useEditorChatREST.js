/**
 * useEditorChatREST — Editor chat hook using REST (CF AI Gateway via Worker)
 *
 * Thin orchestrator that composes focused sub-modules:
 * - useSessionConfig: OpenAI client, MCP, token refresh
 * - streamCompletion: OpenAI streaming
 * - useDisplayMessages: message transformation for display
 * - chatLoop: function-calling loop (reasoning → tools → summarize)
 * - useChatSideEffects: ref syncing, save watching, active-chat persistence
 * - useChangeActions: accept/decline change handlers
 */
import { store as coreStore } from "@wordpress/core-data";
import { useDispatch, useSelect } from "@wordpress/data";
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import { CHAT_STATUS } from "./chat/constants";
import useSessionConfig from "./chat/useSessionConfig";
import { streamCompletion as streamCompletionFn } from "./chat/streamCompletion";
import useDisplayMessages from "./chat/useDisplayMessages";
import { runChatLoop, markTurnStopped } from "./chat/chatLoop";
import useChatSideEffects from "./chat/useChatSideEffects";
import useChangeActions from "./chat/useChangeActions";
import { loadActiveChat, clearActiveChat } from "./chat/activeChatStorage";
import { resetGeneratedImageCache } from "../services/toolDispatcher";
import { setActiveImageEditTarget } from "../services/imageCache";
import { useEditorNavigation } from "../context/editorNavigation";
import { isAbortError } from "../utils/abortControl";
import logger from "../utils/logger";

/**
 * useEditorChatREST Hook
 *
 * @return {Object} Chat state and handlers for the editor
 */
const useEditorChatREST = () => {
	// Restore active chat (messages + model history) from localStorage once,
	// on first mount, so a page reload resumes instead of starting a new chat.
	// Stored in a ref so we don't re-read localStorage on every render.
	const persistedRef = useRef();
	if (persistedRef.current === undefined) {
		persistedRef.current = loadActiveChat();
	}
	const persisted = persistedRef.current;

	// ── Chat state ──
	const [messages, setMessages] = useState(persisted.messages);
	const [status, setStatus] = useState(CHAT_STATUS.IDLE);
	const [error, setError] = useState(null);

	// ── Tool execution state ──
	const [activeToolCall, setActiveToolCall] = useState(null);
	const [toolProgress, setToolProgress] = useState(null);
	const [executedTools, setExecutedTools] = useState([]);
	const [pendingTools, setPendingTools] = useState([]);

	// ── Editor state ──
	const [isSaving, setIsSaving] = useState(false);
	// Shows the "stopped" marker for the most recent turn; cleared on the next send.
	const [wasStopped, setWasStopped] = useState(false);
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);

	// ── Refs ──
	const conversationHistoryRef = useRef(persisted.history);
	// Skip re-adding the system prompt only when the restored history actually
	// starts with one — safer than trusting history.length alone.
	const isFirstMessageRef = useRef(persisted.history[0]?.role !== "system");
	const originalGlobalStylesRef = useRef(null);
	const blockSnapshotRef = useRef(null);
	const executedToolsRef = useRef([]);
	const messagesRef = useRef(messages);
	// Carries an actionable intent (site_management/create_content) forward by
	// exactly one turn when the assistant proposed an action but didn't execute
	// it (e.g. "Shall I apply this palette?"). Without this, a short confirmation
	// reply ("yes") gets classified as `conversational` in isolation, which zeroes
	// out all tools for that turn — so the AI claims it applied the change when
	// it never actually could. See chatLoop.js for how this is consumed/armed.
	const pendingIntentRef = useRef(null);
	// Promise for the turn currently in flight, so a new send can wait it out.
	const runningTurnRef = useRef(null);

	// ── Session config (handles init + token refresh) ──
	const {
		configStatus,
		configError,
		openaiClientRef,
		openaiTools,
		mcpClient,
		abortControllerRef,
		sessionConfigRef,
	} = useSessionConfig();

	// Surface config errors
	useEffect(() => {
		if (configError) {
			setError(configError);
		}
	}, [configError]);

	// ── WordPress dispatch/select ──
	const { savePost } = useDispatch("core/editor");
	const { saveEditedEntityRecord } = useDispatch(coreStore);
	const { requestNavigateToContent } = useEditorNavigation();
	const { __experimentalGetCurrentGlobalStylesId } = useSelect(
		(select) => ({
			__experimentalGetCurrentGlobalStylesId:
				select(coreStore).__experimentalGetCurrentGlobalStylesId,
		}),
		[]
	);
	const isSavingPost = useSelect((select) => select("core/editor").isSavingPost(), []);

	// ── Helpers ──
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	const updateProgress = useCallback(async (message, minTime = 400) => {
		setToolProgress(message);
		await wait(minTime);
	}, []);

	const getSessionConfig = useCallback(() => sessionConfigRef.current, [sessionConfigRef]);

	// ── Tool context builder (shared by executeToolCallsForREST) ──
	const buildToolCtx = useCallback(
		() => ({
			mcpClient,
			openaiClientRef,
			setMessages,
			setStatus,
			setExecutedTools,
			setPendingTools,
			setActiveToolCall,
			setToolProgress,
			setHasGlobalStylesChanges,
			blockSnapshotRef,
			executedToolsRef,
			originalGlobalStylesRef,
			getMessages: () => messagesRef.current,
			updateProgress,
			wait,
			requestNavigateToContent,
		}),
		[mcpClient, openaiClientRef, updateProgress, requestNavigateToContent]
	);

	// ── Streaming (bind deps to plain function) ──
	const streamCompletion = useCallback(
		(msgs, tools, options) =>
			streamCompletionFn(msgs, tools, options, {
				openaiClientRef,
				abortControllerRef,
				setMessages,
			}),
		[openaiClientRef, abortControllerRef, setMessages]
	);

	// ── Derived state ──
	const isLoading =
		status === CHAT_STATUS.GENERATING ||
		status === CHAT_STATUS.TOOL_CALL ||
		status === CHAT_STATUS.SUMMARIZING ||
		configStatus === "loading";

	// ── Display messages ──
	const displayMessages = useDisplayMessages({
		messages,
		activeToolCall,
		pendingTools,
		executedTools,
		toolProgress,
	});

	// ── Side effects ──
	useChatSideEffects({
		messages,
		messagesRef,
		conversationHistoryRef,
		status,
		executedTools,
		executedToolsRef,
		isSaving,
		isSavingPost,
		setMessages,
		setExecutedTools,
		setHasGlobalStylesChanges,
		setIsSaving,
	});

	// ── One chat turn (serialized by handleSendMessage below) ──
	const runTurn = useCallback(
		async (
			messageContent,
			displayMessage = messageContent,
			editClientId = null,
			attachments = []
		) => {
			if (!openaiClientRef.current || configStatus !== "ready") {
				setError("Chat is not ready. Please wait for initialization.");
				return;
			}

			setWasStopped(false);

			// One controller per turn, so Stop cancels tool execution too.
			const turnController = new AbortController();
			abortControllerRef.current = turnController;

			// Reset state
			setExecutedTools([]);
			executedToolsRef.current = [];
			setPendingTools([]);
			setActiveToolCall(null);
			setToolProgress(null);
			setError(null);
			resetGeneratedImageCache();
			// Record the image block being edited AFTER the reset, so the dispatcher
			// can route generate→edit even though the chat sidebar steals selection.
			setActiveImageEditTarget(editClientId);

			const requestStart = performance.now();
			// Rollback point for a stopped turn — runChatLoop appends from here.
			const historyStartLength = conversationHistoryRef.current.length;
			try {
				await runChatLoop(messageContent, {
					conversationHistoryRef,
					isFirstMessageRef,
					pendingIntentRef,
					setMessages,
					setStatus,
					openaiTools,
					streamCompletion,
					buildToolCtx,
					abortControllerRef,
					displayMessage,
					attachments,
					getSessionConfig,
				});

				logger.debug(
					`[EditorChat] Request completed in ${(performance.now() - requestStart).toFixed(0)}ms`
				);
				setStatus(CHAT_STATUS.COMPLETED);
				setTimeout(() => setStatus(CHAT_STATUS.IDLE), 500);
			} catch (err) {
				// Stopping is not an error. A throw skips the loop's own cleanup, so
				// run it here.
				if (isAbortError(err, turnController.signal)) {
					logger.log("[EditorChat] Request aborted");
					markTurnStopped(conversationHistoryRef, pendingIntentRef, historyStartLength);
					setStatus(CHAT_STATUS.IDLE);
					return;
				}
				console.error("[EditorChat] Error in chat loop:", err);
				setError(err.message);
				setStatus(CHAT_STATUS.ERROR);
				setMessages((prev) => [
					...prev,
					{
						id: `error-${Date.now()}`,
						type: "assistant",
						role: "assistant",
						content: __("Something went wrong. Please try again.", "wp-module-editor-chat"),
						timestamp: new Date(),
					},
				]);
			} finally {
				setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
				setActiveToolCall(null);
				setToolProgress(null);
				setPendingTools([]);
			}
		},
		[
			configStatus,
			openaiClientRef,
			openaiTools,
			streamCompletion,
			buildToolCtx,
			abortControllerRef,
			getSessionConfig,
		]
	);

	// ── handleSendMessage ──
	const handleSendMessage = useCallback(
		async (
			messageContent,
			displayMessage = messageContent,
			editClientId = null,
			attachments = []
		) => {
			// Turns run one at a time. Stop sets IDLE immediately, which re-enables the
			// input while the previous turn is still unwinding — an in-flight ability
			// has to resolve before it can exit. Two loops sharing conversationHistoryRef
			// corrupt it, so wait the previous one out (aborting to hurry it along).
			const previous = runningTurnRef.current;
			if (previous) {
				abortControllerRef.current?.abort();
				// Swallow: a failed previous turn must not block this one forever.
				await previous.catch(() => {});
			}

			const turn = runTurn(messageContent, displayMessage, editClientId, attachments);
			runningTurnRef.current = turn;
			try {
				await turn;
			} finally {
				if (runningTurnRef.current === turn) {
					runningTurnRef.current = null;
				}
			}
		},
		[runTurn, abortControllerRef]
	);

	// ── handleNewChat ──
	const handleNewChat = useCallback(() => {
		// Drop the persisted active chat — we're starting fresh.
		clearActiveChat();

		// Reset everything
		resetGeneratedImageCache();
		setMessages([]);
		conversationHistoryRef.current = [];
		isFirstMessageRef.current = true;
		pendingIntentRef.current = null;
		setHasGlobalStylesChanges(false);
		setExecutedTools([]);
		executedToolsRef.current = [];
		setPendingTools([]);
		setActiveToolCall(null);
		setToolProgress(null);
		setError(null);
		setWasStopped(false);
		setStatus(CHAT_STATUS.IDLE);
		originalGlobalStylesRef.current = null;
		blockSnapshotRef.current = null;
	}, []);

	// ── handleStopRequest ──
	const handleStopRequest = useCallback(() => {
		// Keep the controller — its signal is how the loop and dispatcher learn the
		// user stopped. handleSendMessage installs a fresh one next turn.
		abortControllerRef.current?.abort();
		setWasStopped(true);
		setActiveToolCall(null);
		setToolProgress(null);
		setPendingTools([]);
		setError(null);
		setMessages((prev) => prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)));
		setStatus(CHAT_STATUS.IDLE);
	}, [abortControllerRef, setMessages]);

	// ── Accept / Decline changes ──
	const { handleAcceptChanges, handleDeclineChanges } = useChangeActions({
		messages,
		setMessages,
		setIsSaving,
		setHasGlobalStylesChanges,
		hasGlobalStylesChanges,
		originalGlobalStylesRef,
		blockSnapshotRef,
		savePost,
		saveEditedEntityRecord,
		__experimentalGetCurrentGlobalStylesId,
	});

	// Suppress unused — wired up via ChatMessages action buttons
	void handleAcceptChanges;
	void handleDeclineChanges;

	// ── Return interface (same shape as original) ──
	return {
		messages: displayMessages,
		isLoading,
		error,
		status,
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		wasStopped,
		handleSendMessage,
		handleNewChat,
		handleStopRequest,
	};
};

export default useEditorChatREST;
