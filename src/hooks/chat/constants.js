/**
 * Constants for the editor chat hook.
 */

export const EDITOR_CHAT_CONSUMER = "editor_chat";
export const MAX_TOOL_ITERATIONS = 10;
export const MAX_SAME_TOOL_RETRIES = 1;
// Consecutive info-only passes (read-only tools, nothing changed) before we stop
// the loop and force a closing answer. Read-only tools are exempt from retry
// detection, so without this a model that keeps re-reading would spin until
// MAX_TOOL_ITERATIONS and end with no reply. 4 leaves room for legitimate
// multi-block exploration while still catching a stuck "keep reading" loop.
export const MAX_READ_ONLY_PASSES = 4;
// Char budget for READ-ONLY tool results in conversation history. Reads (e.g.
// get-block-markup) return the very data the model reasons over; the default
// 500-char write-ack truncation cuts a section's markup down to its opening tag,
// so the model never sees the styling it asked for and re-reads in a loop. Keep
// reads generous — the history compressor still trims them on later turns.
export const MAX_READ_RESULT_CHARS = 8000;
export const MAX_HISTORY_MESSAGES = 30;
export const MAX_HISTORY_CHARS = 16000;

export const CHAT_STATUS = {
	IDLE: "idle",
	GENERATING: "generating",
	TOOL_CALL: "tool_call",
	SUMMARIZING: "summarizing",
	COMPLETED: "completed",
	ERROR: "error",
};

/**
 * Core block-editing tools. Non-editor tools (posts, media, users, etc.)
 * are only sent to the model when its reasoning plan indicates they're needed.
 */
export const EDITOR_TOOLS = new Set([
	"blu-edit-block",
	"blu-add-section",
	"blu-delete-block",
	"blu-duplicate-block",
	"blu-insert-inner-block",
	"blu-move-block",
	"blu-get-block-markup",
	"blu-highlight-block",
	"blu-update-block-attrs",
	"blu-update-global-styles",
	// Gateway tools — the MCP server exposes abilities through these 3 generic
	// tools instead of individual ones. They must always be available.
	"blu-list-abilities",
	"blu-get-ability-schema",
	"blu-call-ability",
]);

/**
 * Tools that are read-only / non-destructive — exempt from retry detection.
 * Calling these multiple times in a conversation (even with the same args)
 * doesn't change state and isn't an AI mistake, so the retry tracker must
 * skip them. Missing entries here cause the sticky retryLimitHit flag to
 * trip on legitimate exploration and poison the rest of the conversation.
 */
export const READ_ONLY_TOOLS = new Set([
	// Block / page reads
	"blu-get-block-markup",
	"blu-get-global-styles",
	"blu-get-active-global-styles",
	"blu-get-active-global-styles-id",
	"blu-get-active-theme",
	"blu-highlight-block",
	"blu-generate-image",
	"blu-edit-image",
	// Gateway / ability discovery
	"blu-list-abilities",
	"blu-get-ability-schema",
	// REST API discovery
	"blu-list-api-functions",
	"blu-get-function-details",
	// Site / user context reads
	"blu-get-site-info",
	"blu-get-general-settings",
	"blu-get-current-user",
]);
