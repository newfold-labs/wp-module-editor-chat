/**
 * Block-level AI actions invoked directly from the block toolbar,
 * bypassing the chat agent loop. Reuses the same MCP abilities
 * (blu-rewrite-text, blu-generate-image, blu-regenerate-logo) via callAbility.
 *
 * All block mutations go through core/block-editor dispatch, so they
 * participate in the native WP undo stack automatically.
 */
import { dispatch, select } from "@wordpress/data";

import { callAbility } from "../callAbility";
import { mcpClient, openaiClientRef } from "../../hooks/chat/useSessionConfig";

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
export const IMAGE_BLOCKS = new Set([
	"core/image",
	"core/cover",
	"core/post-featured-image",
]);

export const LOGO_BLOCK = "core/site-logo";

export function isSupportedBlock(name) {
	return (
		TEXT_BLOCKS.has(name) ||
		IMAGE_BLOCKS.has(name) ||
		name === LOGO_BLOCK
	);
}

/** Read the editable text from a text block, regardless of which attribute holds it. */
function getBlockText(block) {
	const a = block.attributes || {};
	return a.content ?? a.value ?? a.text ?? "";
}

/** Parse the JSON text payload an MCP ability returns in content[0].text. */
function parseAbilityResult(mcpResult) {
	if (mcpResult?.isError || !mcpResult?.content?.[0]?.text) {
		return null;
	}
	try {
		return JSON.parse(mcpResult.content[0].text);
	} catch {
		return null;
	}
}

/**
 * Rewrite text in place via a direct single-shot OpenAI call (no agent loop).
 * For core/media-text the editable text lives in an inner core/paragraph.
 */
async function applyText(block, instruction) {
	const client = openaiClientRef.current;
	if (!client) {
		throw new Error("AI session not ready yet — please wait a moment and try again.");
	}

	let targetClientId = block.clientId;
	let current = getBlockText(block);


	// Strip HTML tags to give the AI clean text, preserve HTML in the update.
	const plain = (current || "").replace(/<[^>]+>/g, "").trim();
	const isEmpty = !plain;

	const systemContent = isEmpty
	  ? "You are a professional copywriter. Generate text from the user's instruction. " +
		"Return ONLY the final text. Never ask questions. Never explain. No quotes."
	  : "You are a professional copywriter. Rewrite the text following the instruction. " +
		"Return ONLY the rewritten text. Never ask questions. Never explain. No quotes.";
	const userContent = isEmpty
	  ? `Instruction: ${instruction}`
	  : `Instruction: ${instruction}\n\nText: ${plain}`;

	const model = window.nfdEditorChat?.model || undefined;
	const response = await client.chat.completions.create({
		model,
		messages: [
			{
				role: "system",
				content:systemContent
			},
			{
				role: "user",
				content: userContent,
			},
		],
		stream: false,
	});
	const next = response.choices?.[0]?.message?.content?.trim();
	if (!next) {
		throw new Error("The AI did not return any text.");
	}
	dispatch("core/block-editor").updateBlockAttributes(targetClientId, { content: next });
}

/** Generate an image and swap it into the block. */
async function applyImage(block, instruction) {
	const result = await callAbility(mcpClient, "blu-generate-image", { prompt: instruction });
	const parsed = parseAbilityResult(result);
	const url = parsed?.message?.url ?? parsed?.url;
	if (!url) {
		throw new Error("The AI did not return an image.");
	}



	// core/image, core/cover, core/post-featured-image all accept url; clear the
	// media-library id so WP doesn't override our URL with the old attachment.
	dispatch("core/block-editor").updateBlockAttributes(block.clientId, {
		url,
		id: 0,
	});
}

/** Regenerate the site logo. Mirrors handleRegenerateLogo (toolHandlers/regenerateLogo.js). */
async function applyLogo(instruction) {
	const result = await callAbility(mcpClient, "blu-regenerate-logo", { prompt: instruction });
	if (result?.isError) {
		throw new Error("Logo generation failed.");
	}
	// Invalidate the site entity so the core/site-logo block re-fetches & re-renders.
	try {
		dispatch("core").invalidateResolution("getEntityRecord", ["root", "site", undefined]);
	} catch {
		// non-critical — logo saved; a reload would show it anyway
	}
}

/**
 * Single entry point used by the popover.
 *
 * @param {Object} params
 * @param {Object} params.block          The selected block object.
 * @param {string} params.instruction    The user's typed instruction.
 * @param {string} [params.mediaTextMode] "text" | "image" — only for core/media-text.
 */
export async function applyBlockAI({ block, instruction, mediaTextMode }) {
	const name = block.name;

	if (name === LOGO_BLOCK) {
		return applyLogo(instruction);
	}
	
	if (IMAGE_BLOCKS.has(name)) {
		return applyImage(block, instruction);
	}
	if (TEXT_BLOCKS.has(name)) {
		return applyText(block, instruction);
	}
	throw new Error(`Unsupported block type: ${name}`);
}

// Re-export select so the component can re-read the freshest block if needed.
export { select };