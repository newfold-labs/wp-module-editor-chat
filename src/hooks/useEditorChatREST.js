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
import { runChatLoop } from "./chat/chatLoop";
import useChatSideEffects from "./chat/useChatSideEffects";
import useConversationSync from "./chat/useConversationSync";
import useChangeActions from "./chat/useChangeActions";
import { loadActiveChat, clearActiveChat } from "./chat/activeChatStorage";
import { resetGeneratedImageCache } from "../services/toolDispatcher";
import { setActiveImageEditTarget } from "../services/imageCache";
import { useEditorNavigation } from "../context/editorNavigation";
import { getEditUrl } from "../services/contentNavigation";
import {
	createConversation,
	updateConversation,
	getConversation,
	deleteConversation,
} from "../services/conversationsApi";
import {
	getCurrentPageId,
	getCurrentPageType,
	getCurrentPageModified,
} from "../utils/editorHelpers";
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
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);

	// ── Refs ──
	const conversationHistoryRef = useRef(persisted.history);
	// Skip re-adding the system prompt only when the restored history actually
	// starts with one — safer than trusting history.length alone.
	const isFirstMessageRef = useRef(persisted.history[0]?.role !== "system");
	// Set true when hydrating a past conversation from history; tells chatLoop
	// to prepend a one-time note that prior tool results may reference
	// clientIds that no longer exist on the (possibly-edited) current page.
	const needsResumeNoticeRef = useRef(false);
	// post_id the active conversation is bound to (set at creation/hydration,
	// never re-derived from the DB row after that) — used to detect when the
	// user has navigated to a different page while this conversation stays
	// open, so we can start a fresh chat instead of misattributing edits.
	const conversationPostIdRef = useRef(persisted.postId ?? null);
	// Session-only cache of per-page chat state (post_id -> { conversationId,
	// messages, history, isFirstMessage }), so flipping back and forth between
	// a few pages in the same editor session restores progress instead of
	// discarding it. Lost on a full reload by design — activeChatStorage's
	// single-slot fallback covers whichever page was active at that point.
	const pagesCacheRef = useRef(new Map());
	const originalGlobalStylesRef = useRef(null);
	const blockSnapshotRef = useRef(null);
	const executedToolsRef = useRef([]);
	const messagesRef = useRef(messages);

	// ── Server-side conversation sync ──
	const { conversationId, setConversationId, readOnly, setReadOnly, resetSync } =
		useConversationSync({
			messages,
			conversationHistoryRef,
			initialConversationId: persisted.conversationId,
			onConversationCreated: (_id, postId) => {
				conversationPostIdRef.current = postId;
			},
		});

	// One-time migration: push any pre-existing localStorage chat (within its
	// 24h TTL) to the server, then stop checking. Simplest possible retry
	// story: on any failure, don't set the flag and don't clear localStorage —
	// the whole migration (including a fresh POST) just runs again next load.
	// A rare partial failure can leave one extra empty row server-side; that
	// has no functional impact and isn't worth guarding against.
	// Gate on the post actually being loaded — at first mount getCurrentPostId()
	// can still be 0 (Site Editor resolves the current post async), which would
	// send post_id: 0 and get a 400 back. Re-checks on every render until the
	// post resolves, then runs exactly once.
	const migrationPostId = useSelect((select) => select("core/editor").getCurrentPostId(), []);
	const migrationAttemptedRef = useRef(false);
	useEffect(() => {
		if (migrationAttemptedRef.current || !migrationPostId) {
			return;
		}
		migrationAttemptedRef.current = true;

		if (localStorage.getItem("nfd-editor-chat-migrated")) {
			return;
		}

		(async () => {
			try {
				const legacy = loadActiveChat();
				if (legacy.messages.length > 0) {
					const created = await createConversation({
						postId: migrationPostId,
						postType: getCurrentPageType(),
						postModifiedSeenAt: getCurrentPageModified(),
					});
					await updateConversation(created.id, {
						messages: legacy.messages,
						history: legacy.history,
						postModifiedSeenAt: getCurrentPageModified(),
					});
					setConversationId(created.id);
					conversationPostIdRef.current = migrationPostId;
				}
				localStorage.setItem("nfd-editor-chat-migrated", "1");
				clearActiveChat();
			} catch (err) {
				logger.warn("[EditorChat] Legacy chat migration failed, will retry next load:", err);
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, as soon as migrationPostId resolves
	}, [migrationPostId]);

	// Backfill conversationPostIdRef from the server when a restored
	// conversation's post_id wasn't in the local fallback cache — e.g. an
	// entry saved before post_id tracking existed, or one that failed to
	// persist for any other reason. Without this, the page-switch detection
	// below silently never fires for that conversation (its "bound page"
	// stays unknown forever, since the only other place that sets this ref
	// is the create step, which doesn't run again for an existing id).
	useEffect(() => {
		if (!persisted.conversationId || conversationPostIdRef.current) {
			return;
		}
		(async () => {
			try {
				const conversation = await getConversation(persisted.conversationId);
				conversationPostIdRef.current = conversation.post_id;
			} catch (err) {
				logger.warn("[EditorChat] Could not resolve post_id for restored conversation:", err);
			}
		})();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount by design
	}, []);

	// ── History resume: hydration + page-conflict resolution ──
	const [pageConflict, setPageConflict] = useState(null); // { conversation } | null
	// Distinguishes "read-only because the page was trashed/deleted" (shows the
	// persistent note + delete action) from "read-only because the user chose
	// to continue here after a different-page conflict" (no ongoing banner —
	// the conflict prompt already explained it before being dismissed).
	const [resumedPostMissing, setResumedPostMissing] = useState(false);
	const [driftInfo, setDriftInfo] = useState(null); // { seenAt: string } | null

	const applyHydratedConversation = useCallback(
		(conversation, { readOnly: ro }) => {
			const { messages: msgs = [], history = [] } = conversation.messages || {};
			setMessages(msgs);
			conversationHistoryRef.current = history;
			// Unlike the localStorage-restore case (where an ambiguous heuristic is
			// needed), we know definitively whether this conversation has prior
			// turns — only treat the next message as "first" if it truly has none.
			isFirstMessageRef.current = history.length === 0;
			needsResumeNoticeRef.current = true;
			setConversationId(conversation.id);
			setReadOnly(ro);
			setResumedPostMissing(!conversation.post_exists);
			conversationPostIdRef.current = conversation.post_id;

			const currentModified = getCurrentPageModified();
			const seenAt = conversation.post_modified_seen_at;
			setDriftInfo(currentModified && seenAt && currentModified !== seenAt ? { seenAt } : null);
		},
		[setConversationId, setReadOnly]
	);

	const dismissDrift = useCallback(() => setDriftInfo(null), []);

	const handleOpenConversationFromHistory = useCallback(
		async (item) => {
			const conversation = await getConversation(item.id);

			if (!conversation.post_exists) {
				applyHydratedConversation(conversation, { readOnly: true });
				return;
			}

			const currentPostId = getCurrentPageId();
			if (conversation.post_id !== currentPostId) {
				setPageConflict({ conversation });
				return;
			}

			applyHydratedConversation(conversation, { readOnly: false });
		},
		[applyHydratedConversation]
	);

	const resolvePageConflict = useCallback(
		(action) => {
			if (!pageConflict) {
				return;
			}
			const { conversation } = pageConflict;
			if (action === "navigate") {
				window.location.href = getEditUrl(conversation.post_type, conversation.post_id);
				return;
			}
			applyHydratedConversation(conversation, { readOnly: true });
			setPageConflict(null);
		},
		[pageConflict, applyHydratedConversation]
	);

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
		conversationId,
		conversationPostIdRef,
		setMessages,
		setExecutedTools,
		setHasGlobalStylesChanges,
		setIsSaving,
	});

	// ── handleSendMessage ──
	const handleSendMessage = useCallback(
		async (messageContent, displayMessage = messageContent, editClientId = null) => {
			if (!openaiClientRef.current || configStatus !== "ready") {
				setError("Chat is not ready. Please wait for initialization.");
				return;
			}

			// Reset state
			setExecutedTools([]);
			executedToolsRef.current = [];
			setPendingTools([]);
			setActiveToolCall(null);
			setToolProgress(null);
			setError(null);
			setPageConflict(null);
			setResumedPostMissing(false);
			setDriftInfo(null);
			resetGeneratedImageCache();
			// Record the image block being edited AFTER the reset, so the dispatcher
			// can route generate→edit even though the chat sidebar steals selection.
			setActiveImageEditTarget(editClientId);

			const requestStart = performance.now();
			try {
				await runChatLoop(messageContent, {
					conversationHistoryRef,
					isFirstMessageRef,
					needsResumeNoticeRef,
					setMessages,
					setStatus,
					openaiTools,
					streamCompletion,
					buildToolCtx,
					abortControllerRef,
					displayMessage,
					getSessionConfig,
				});

				logger.debug(
					`[EditorChat] Request completed in ${(performance.now() - requestStart).toFixed(0)}ms`
				);
				setStatus(CHAT_STATUS.COMPLETED);
				setTimeout(() => setStatus(CHAT_STATUS.IDLE), 500);
			} catch (err) {
				if (err.name === "AbortError") {
					logger.log("[EditorChat] Request aborted");
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

	// ── handleNewChat ──
	const handleNewChat = useCallback(() => {
		resetSync();
		setPageConflict(null);
		setResumedPostMissing(false);
		setDriftInfo(null);
		// Drop the persisted active chat — we're starting fresh.
		clearActiveChat();

		// Reset everything
		resetGeneratedImageCache();
		setMessages([]);
		conversationHistoryRef.current = [];
		isFirstMessageRef.current = true;
		conversationPostIdRef.current = null;
		setHasGlobalStylesChanges(false);
		setExecutedTools([]);
		executedToolsRef.current = [];
		setPendingTools([]);
		setActiveToolCall(null);
		setToolProgress(null);
		setError(null);
		setStatus(CHAT_STATUS.IDLE);
		originalGlobalStylesRef.current = null;
		blockSnapshotRef.current = null;
	}, [resetSync]);

	// ── handleDeleteCurrentConversation ──
	const handleDeleteCurrentConversation = useCallback(async () => {
		if (!conversationId) {
			return;
		}
		await deleteConversation(conversationId);
		handleNewChat();
	}, [conversationId, handleNewChat]);

	// Switch chat context when the user navigates to a different page while an
	// active (read-write) conversation is open. Without this, edits would keep
	// landing on a conversation row still bound to the page it was created
	// for, and the drift watermark would get corrupted with the new page's
	// timestamp. Read-only conversations are exempt — those are intentionally
	// viewed against a different page (see the history-resume page-conflict
	// flow), so a mismatch there is expected, not a drift.
	//
	// The outgoing page's state is parked in pagesCacheRef rather than
	// discarded: if the destination page was already visited this session,
	// its chat is restored; otherwise a fresh chat starts, same as "+ New Chat".
	const activeEditorPostId = useSelect((select) => select("core/editor").getCurrentPostId(), []);
	useEffect(() => {
		if (
			readOnly ||
			!conversationPostIdRef.current ||
			!activeEditorPostId ||
			conversationPostIdRef.current === activeEditorPostId
		) {
			return;
		}

		pagesCacheRef.current.set(conversationPostIdRef.current, {
			conversationId,
			messages,
			history: conversationHistoryRef.current,
			isFirstMessage: isFirstMessageRef.current,
		});

		const cached = pagesCacheRef.current.get(activeEditorPostId);
		if (cached) {
			pagesCacheRef.current.delete(activeEditorPostId);
			setMessages(cached.messages);
			conversationHistoryRef.current = cached.history;
			isFirstMessageRef.current = cached.isFirstMessage;
			setConversationId(cached.conversationId);
			conversationPostIdRef.current = activeEditorPostId;
		} else {
			handleNewChat();
		}
	}, [activeEditorPostId, readOnly, handleNewChat, conversationId, messages, setConversationId]);

	// ── handleStopRequest ──
	const handleStopRequest = useCallback(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
			abortControllerRef.current = null;
		}
		setActiveToolCall(null);
		setToolProgress(null);
		setPendingTools([]);
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
		handleSendMessage,
		handleNewChat,
		handleStopRequest,
		conversationId,
		readOnly,
		resumedPostMissing,
		pageConflict,
		handleOpenConversationFromHistory,
		resolvePageConflict,
		handleDeleteCurrentConversation,
		driftInfo,
		dismissDrift,
	};
};

export default useEditorChatREST;
