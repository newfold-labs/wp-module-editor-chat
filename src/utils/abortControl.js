/**
 * abortControl — turn-scoped cancellation.
 *
 * A turn creates one AbortController and passes its SIGNAL down. Always test the
 * captured signal, never `ref.current` — Stop leaves work in flight, and by the
 * time it resolves the ref may hold the next turn's controller, which reports
 * "not aborted" and waves the stale work through.
 */

/**
 * Build an error matching what the platform throws on abort.
 *
 * @return {Error} Error whose `name` is `"AbortError"`.
 */
export function createAbortError() {
	return new DOMException("The chat turn was stopped by the user.", "AbortError");
}

/**
 * Whether a caught error means "stopped" rather than "failed".
 *
 * The signal is authoritative — the OpenAI SDK's abort error leaves `name` as
 * `"Error"`, and its stream iterator can swallow the abort entirely.
 *
 * @param {*}           error    The caught error.
 * @param {AbortSignal} [signal] Signal captured when the turn started.
 * @return {boolean} True when the turn was stopped.
 */
export function isAbortError(error, signal) {
	return signal?.aborted === true || error?.name === "AbortError";
}
