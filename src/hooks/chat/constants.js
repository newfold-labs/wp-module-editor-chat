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
// Output-token ceiling. Without one the upstream default (4096) truncates
// tool_use JSON mid-argument on large sections.
export const MAX_COMPLETION_TOKENS = 16000;
// Raised ceiling for the retry after a cut-off.
export const MAX_COMPLETION_TOKENS_RETRY = 32000;

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
	// Local (in-browser, zero-network) editor abilities — see
	// src/services/localToolRegistry.js and docs/local-abilities.md. Without
	// these here, getToolsForIntent() strips them out for every intent except
	// create_content/site_management, so the model never sees them for the
	// ordinary edit_page/conversational passes these abilities are meant for.
	"editor_get-editor-tree",
	"editor_find-editor-blocks",
	"editor_get-block-location",
	"editor_get-editor-selection",
	"editor_can-insert-block",
	"editor_edit-block",
	"editor_move-block",
	"editor_remove-block",
	"editor_update-block",
	"editor_get-block-types",
	"editor_get-block-type",
	"editor_get-patterns",
	"editor_get-pattern",
	"editor_get-pattern-categories",
	"editor_insert-block",
	"editor_insert-pattern",
	"editor_create-pattern",
	"editor_transform-block",
	"editor_select-block",
	"editor_undo",
	"editor_redo",
]);

/**
 * Tools that are read-only / non-destructive — exempt from retry detection.
 * Calling these multiple times in a conversation (even with the same args)
 * doesn't change state and isn't an AI mistake, so the retry tracker must
 * skip them. Missing entries here cause the sticky retryLimitHit flag to
 * trip on legitimate exploration and poison the rest of the conversation.
 *
 * For `editor_*` tools this list doubles as the write/read split
 * toolDispatcher.js's `isLocalWriteTool()` uses to set `hasChanges` and
 * capture the pre-mutation undo snapshot — a local ability missing from
 * here is treated as a write (a spurious snapshot/undo entry, not a
 * missed one). Add every new read-only `editor_*` ability here too.
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
	// Document / image analysis reads — exempt from retry detection
	"blu-read-document",
	"blu-extract-image-colors",
	"blu-generate-color-palette",
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
	// Local (in-browser) editor abilities that do not mutate the document.
	// Without these here, calling one more than once in a conversation (e.g.
	// checking the selection again after the user clicks a different block)
	// would trip the retry-limit tracker as if it were a stuck mistake.
	"editor_get-editor-tree",
	"editor_find-editor-blocks",
	"editor_get-block-location",
	"editor_get-editor-selection",
	"editor_can-insert-block",
	"editor_get-block-types",
	"editor_get-block-type",
	"editor_get-patterns",
	"editor_get-pattern",
	"editor_get-pattern-categories",
	// Selection only — does not mutate the document. Missing this would make
	// isLocalWriteTool() capture a spurious undo snapshot on every select.
	"editor_select-block",
]);
