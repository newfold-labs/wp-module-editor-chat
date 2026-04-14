/* global localStorage, window */
/**
 * activeChatStorage — persists the current (resumable) editor chat in
 * localStorage so a page reload restores the active conversation. This is
 * separate from the history-dropdown archive: the archive holds past chats,
 * this key holds the one currently in progress.
 *
 * Stale entries (older than TTL_MS) are discarded on load — after a long
 * enough gap the editor context has almost certainly drifted (different
 * post, different styles) and resuming would be worse than starting over.
 */
import { simpleHash } from "@newfold-labs/wp-module-ai-chat";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const getStorageKey = () => {
	const siteId = simpleHash(window.nfdEditorChat?.homeUrl || "");
	return `nfd-editor-chat-active-${siteId}`;
};

// Always return fresh arrays — callers mutate `history` via chatLoop's push,
// so a shared constant would leak state across calls.
const emptyState = () => ({ messages: [], history: [] });

export const loadActiveChat = () => {
	const key = getStorageKey();
	try {
		const raw = localStorage.getItem(key);
		if (!raw) {
			return emptyState();
		}
		const parsed = JSON.parse(raw);
		const savedAt = Date.parse(parsed.savedAt);
		if (!Number.isFinite(savedAt) || Date.now() - savedAt > TTL_MS) {
			localStorage.removeItem(key);
			return emptyState();
		}
		// Strip transient fields so accept/decline buttons don't reappear on reload.
		const messages = (parsed.messages || []).map(
			({ hasActions: _hasActions, undoData: _undoData, ...rest }) => rest
		);
		return { messages, history: parsed.history || [] };
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn("[EditorChat] Failed to load active chat:", err);
		return emptyState();
	}
};

export const saveActiveChat = (messages, history) => {
	try {
		const key = getStorageKey();
		if ((!messages || messages.length === 0) && (!history || history.length === 0)) {
			localStorage.removeItem(key);
			return;
		}
		// Drop transient UI-only fields at write time so we don't bloat storage.
		const trimmedMessages = (messages || []).map(
			({ hasActions: _hasActions, undoData: _undoData, ...rest }) => rest
		);
		localStorage.setItem(
			key,
			JSON.stringify({
				messages: trimmedMessages,
				history: history || [],
				savedAt: new Date().toISOString(),
			})
		);
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn("[EditorChat] Failed to save active chat:", err);
	}
};

export const clearActiveChat = () => {
	try {
		localStorage.removeItem(getStorageKey());
	} catch (err) {
		// eslint-disable-next-line no-console
		console.warn("[EditorChat] Failed to clear active chat:", err);
	}
};
