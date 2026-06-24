/**
 * Helpers for upserting a single in-place streaming assistant row per turn.
 * Avoids the overlay-then-replace pattern that made the same text appear to
 * rewrite in a new bubble.
 */

/**
 * @param {Function} setMessages React state setter.
 * @param {string}   messageId   Stable row id for this stream slot.
 * @param {string}   content     Full accumulated assistant text so far.
 */
export function upsertStreamingMessage(setMessages, messageId, content) {
	if (!content) {
		return;
	}
	setMessages((prev) => {
		const idx = prev.findIndex((m) => m.id === messageId);
		const row = {
			id: messageId,
			type: "assistant",
			role: "assistant",
			content,
			isStreaming: true,
			timestamp: new Date(),
		};
		if (idx >= 0) {
			const next = [...prev];
			next[idx] = { ...next[idx], ...row };
			return next;
		}
		return [...prev, row];
	});
}

/**
 * @param {Function} setMessages React state setter.
 * @param {string}   messageId   Stream row id.
 * @param {string}   content     Final assistant text.
 */
export function finalizeStreamingMessage(setMessages, messageId, content) {
	if (!content?.trim()) {
		removeStreamingMessage(setMessages, messageId);
		return;
	}
	setMessages((prev) => {
		const idx = prev.findIndex((m) => m.id === messageId);
		if (idx >= 0) {
			const next = [...prev];
			next[idx] = {
				...next[idx],
				content,
				isStreaming: false,
				preferPlainText: true,
				timestamp: new Date(),
			};
			return next;
		}
		return [
			...prev,
			{
				id: messageId,
				type: "assistant",
				role: "assistant",
				content,
				preferPlainText: true,
				timestamp: new Date(),
			},
		];
	});
}

/**
 * @param {Function} setMessages React state setter.
 * @param {string}   messageId   Stream row id.
 */
export function removeStreamingMessage(setMessages, messageId) {
	setMessages((prev) => prev.filter((m) => m.id !== messageId));
}

/**
 * @param {Function} setMessages React state setter.
 * @param {string}   messageId   Stream row id.
 */
export function resetStreamingMessage(setMessages, messageId) {
	setMessages((prev) => {
		const idx = prev.findIndex((m) => m.id === messageId);
		if (idx < 0) {
			return prev;
		}
		const existing = prev[idx];
		// Never wipe a finalized row — a new stream slot should use a different id.
		if (!existing.isStreaming) {
			return prev;
		}
		const next = [...prev];
		next[idx] = {
			...existing,
			content: "",
			isStreaming: true,
			preferPlainText: undefined,
			timestamp: new Date(),
		};
		return next;
	});
}
