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
