/**
 * Block-toolbar allowlists and helpers.
 * Shared between the toolbar button, popover, and chat feedback effects.
 */

// ── Allowlists (shared with the toolbar component) ──
export const TEXT_BLOCKS = new Set([
	"core/paragraph",
	"core/heading",
	"core/list-item",
	"core/quote",
	"core/button",
	"core/site-title",
	"core/post-title",
	"core/post-excerpt",
]);
export const IMAGE_BLOCKS = new Set(["core/image", "core/cover"]);

export const LOGO_BLOCK = "core/site-logo";

export function isSupportedBlock(name) {
	return TEXT_BLOCKS.has(name) || IMAGE_BLOCKS.has(name) || name === LOGO_BLOCK;
}
