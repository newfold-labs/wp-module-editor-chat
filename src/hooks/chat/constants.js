/**
 * Constants for the editor chat hook.
 */

export const EDITOR_CHAT_CONSUMER = "editor_chat";
export const MAX_TOOL_ITERATIONS = 10;
export const MAX_SAME_TOOL_RETRIES = 1;

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
	"blu-update-block-attrs",
	"blu-update-global-styles",
	// blu-generate-image intentionally excluded — image generation is handled
	// internally via image_prompts on blu-add-section (for new sections) and
	// image_prompt on blu-update-block-attrs (for existing images).
	// This prevents the AI from looping on generate-image calls.
]);

/**
 * Tools that are read-only / non-destructive — exempt from retry detection.
 */
export const READ_ONLY_TOOLS = new Set([
	"blu-get-block-markup",
	"blu-get-global-styles",
	"blu-get-active-global-styles",
	"blu-search-patterns",
	"blu-highlight-block",
	"blu-generate-image",
]);
