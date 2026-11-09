/**
 * An operation that the reusable editor layer deliberately cannot perform.
 *
 * Fallback metadata is valid only when no mutation was attempted.
 */
export class EditorAbilityUnsupportedError extends Error {
	constructor(message, fallback = null) {
		super(message);
		this.name = "EditorAbilityUnsupportedError";
		this.mutated = false;
		if (fallback?.tool && fallback?.arguments) {
			this.fallbackTool = fallback.tool;
			this.fallbackArguments = fallback.arguments;
		}
	}
}

/**
 * Mark an error that occurred after a write was dispatched or persisted.
 *
 * @param {unknown}   error         Original error.
 * @param {unknown[]} cleanupErrors Cleanup failures that must remain visible.
 * @return {Error} Mutation-aware error for native and bridged consumers.
 */
export function markAbilityMutationError(error, cleanupErrors = []) {
	const marked = error instanceof Error ? error : new Error(String(error));
	marked.mutated = true;
	delete marked.fallbackTool;
	delete marked.fallbackArguments;
	if (cleanupErrors.length) {
		marked.message += ` Cleanup failed: ${cleanupErrors
			.map((cleanupError) => String(cleanupError?.message || cleanupError))
			.join("; ")}`;
	}
	return marked;
}
