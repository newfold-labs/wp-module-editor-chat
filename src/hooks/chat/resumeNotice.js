/**
 * One-shot note sent to the model on the first turn after a chat is resumed
 * from history. Stored tool calls may point at blocks that no longer exist, so
 * they are history, not truth. The note is added to the outgoing request only
 * and is never persisted with the conversation.
 */
export const RESUME_NOTICE =
	"Prior tool results in this conversation may reference block clientIds that no longer exist on the current page. Always re-read the current block tree before acting.";

/**
 * Take the note if a resume is pending, clearing the pending flag.
 *
 * @param {{current: boolean}} [needsResumeNoticeRef] Ref set to true when a chat was resumed.
 * @return {{role: string, content: string}|null} The system message, or null when nothing is pending.
 */
export function consumeResumeNotice(needsResumeNoticeRef) {
	if (!needsResumeNoticeRef?.current) {
		return null;
	}
	needsResumeNoticeRef.current = false;
	return { role: "system", content: RESUME_NOTICE };
}
