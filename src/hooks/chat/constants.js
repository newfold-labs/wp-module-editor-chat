/**
 * Constants for the editor chat hook.
 */

export const EDITOR_CHAT_CONSUMER = "editor_chat";
export const MAX_TOOL_ITERATIONS = 10;
export const MAX_SAME_TOOL_RETRIES = 1;
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
	"blu-move-block",
	"blu-get-block-markup",
	"blu-highlight-block",
	"blu-rewrite-text",
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
	"blu-search-patterns",
	"blu-highlight-block",
	"blu-generate-image",
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
