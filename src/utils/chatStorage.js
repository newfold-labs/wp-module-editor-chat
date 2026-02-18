/* eslint-disable no-undef, no-console */
/**
 * Chat localStorage utilities.
 *
 * Pure helper functions for persisting editor-chat session data.
 * No React dependency — safe to import from anywhere.
 *
 * Archive functions (archiveConversation, getChatHistoryStorageKeys, etc.)
 * live in wp-module-ai-chat and are imported directly by useEditorChat.
 */
import { simpleHash } from "@newfold-labs/wp-module-ai-chat";

/**
 * Get site-specific localStorage keys for chat persistence
 *
 * @return {Object} Storage keys object with site-specific keys
 */
export const getStorageKeys = () => {
	const siteId = simpleHash(window.nfdEditorChat?.homeUrl || "default");
	return {
		SESSION_ID: `nfd-editor-chat-session-id-${siteId}`,
		MESSAGES: `nfd-editor-chat-messages-${siteId}`,
	};
};

/**
 * Load session ID from localStorage
 *
 * @return {string|null} The session ID or null
 */
export const loadSessionId = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		return localStorage.getItem(STORAGE_KEYS.SESSION_ID);
	} catch (error) {
		console.warn("Failed to load session ID from localStorage:", error);
		return null;
	}
};

/**
 * Save session ID to localStorage
 *
 * @param {string} sessionId The session ID to save
 */
export const saveSessionId = (sessionId) => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		if (sessionId) {
			localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
		} else {
			localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
		}
	} catch (error) {
		console.warn("Failed to save session ID to localStorage:", error);
	}
};

/**
 * Load messages from localStorage
 *
 * @return {Array} Array of messages
 */
export const loadMessages = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		const stored = localStorage.getItem(STORAGE_KEYS.MESSAGES);
		if (stored) {
			const messages = JSON.parse(stored);
			return messages
				.map((msg) => {
					const { hasActions, undoData, isStreaming, ...rest } = msg;
					return rest;
				})
				.filter((msg) => {
					if (msg.type === "user") {
						return true;
					}
					const hasContent = msg.content !== null && msg.content !== "";
					const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
					return hasContent || hasToolCalls;
				});
		}
		return [];
	} catch (error) {
		console.warn("Failed to load messages from localStorage:", error);
		return [];
	}
};

/**
 * Save messages to localStorage
 *
 * @param {Array} messages Array of messages to save
 */
export const saveMessages = (messages) => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		const cleanMessages = messages.map(({ isStreaming, ...rest }) => rest);
		localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(cleanMessages));
	} catch (error) {
		console.warn("Failed to save messages to localStorage:", error);
	}
};

/**
 * Clear all chat data from localStorage
 */
export const clearChatData = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
		localStorage.removeItem(STORAGE_KEYS.MESSAGES);
	} catch (error) {
		console.warn("Failed to clear chat data from localStorage:", error);
	}
};
