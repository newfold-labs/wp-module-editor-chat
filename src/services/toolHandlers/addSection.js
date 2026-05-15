import { __ } from "@wordpress/i18n";

import { validateBlockMarkup } from "../../utils/blockValidator";
import { handleAddAction } from "../blockActions";
import { callAbility } from "../callAbility";
import { appendGeneratedImageUrl, deduplicateImages, getGeneratedImageUrls } from "../imageCache";

export async function handleAddSection(toolCall, args, ctx) {
	// ── Image placeholder resolution ──
	// Count __IMG_N__ placeholders in the markup
	const imgPlaceholders = args.block_content.match(/__IMG_\d+__/g) || [];
	const uniquePlaceholders = [...new Set(imgPlaceholders)];

	if (uniquePlaceholders.length > 0) {
		// Preferred path: generate images from image_prompts (markup-first flow)
		if (args.image_prompts && Array.isArray(args.image_prompts) && args.image_prompts.length > 0) {
			const promptCount = Math.min(args.image_prompts.length, uniquePlaceholders.length);

			const imageUrls = [];
			for (let i = 0; i < promptCount; i++) {
				const prompt = args.image_prompts[i];
				const imgArgs =
					typeof prompt === "string" ? { prompt } : { prompt: prompt.prompt, ...prompt };

				await ctx.updateProgress(
					__("Generating image…", "wp-module-editor-chat") + ` (${i + 1}/${promptCount})`,
					500
				);
				try {
					const mcpResult = await callAbility(ctx.mcpClient, "blu-generate-image", imgArgs);
					if (!mcpResult.isError && mcpResult.content?.[0]?.text) {
						const parsed = JSON.parse(mcpResult.content[0].text);
						const url = parsed?.message?.url || parsed?.url;
						if (url) {
							imageUrls.push(url);
							appendGeneratedImageUrl(url);
						}
					}
				} catch {
					// image generation failed — non-critical
				}
			}

			// Substitute placeholders with generated URLs
			for (let i = 0; i < imageUrls.length; i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, imageUrls[i]);
			}
		}
		// Fallback: substitute from pre-supplied image_urls array
		else if (args.image_urls && Array.isArray(args.image_urls) && args.image_urls.length > 0) {
			for (let i = 0; i < args.image_urls.length; i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, args.image_urls[i]);
			}
		}
		// Fallback: substitute from previously generated images in this turn
		else if (getGeneratedImageUrls().length > 0) {
			const cached = getGeneratedImageUrls();
			for (let i = 0; i < Math.min(cached.length, uniquePlaceholders.length); i++) {
				args.block_content = args.block_content.replaceAll(`__IMG_${i + 1}__`, cached[i]);
			}
		}

		// Warn about unresolved placeholders
	}

	await ctx.updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

	// Strip escaped quotes the LLM may copy from JSON-encoded tool results
	args.block_content = args.block_content.replace(/\\"/g, '"');

	// ── Auto-deduplicate images ──
	// If the AI used the same image URL more than once, replace duplicates
	// with unused generated images from this conversation turn.
	if (getGeneratedImageUrls().length > 0) {
		const dedup = deduplicateImages(args.block_content, getGeneratedImageUrls());
		if (dedup.replacements.length > 0) {
			args.block_content = dedup.markup;
		}
	}

	const validation = validateBlockMarkup(args.block_content);
	if (!validation.valid) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) }],
			isError: true,
		};
	}

	// Use auto-corrected content if the validator fixed class order / missing meta-classes
	const finalAddContent = validation.correctedContent || args.block_content;

	// Force constrained layout on the outermost block comment
	let sectionContent = finalAddContent;
	try {
		const commentEnd = sectionContent.indexOf("-->");
		if (commentEnd !== -1) {
			const comment = sectionContent.substring(0, commentEnd + 3);
			const nameMatch = comment.match(/<!-- wp:(\S+)/);
			if (nameMatch) {
				const blockName = nameMatch[1];
				const braceStart = comment.indexOf("{");
				const braceEnd = comment.lastIndexOf("}");

				let attrs = {};
				if (braceStart !== -1 && braceEnd > braceStart) {
					attrs = JSON.parse(comment.substring(braceStart, braceEnd + 1));
				}

				if (!attrs.layout) {
					attrs.layout = { type: "constrained" };
					const newComment = `<!-- wp:${blockName} ${JSON.stringify(attrs)} -->`;
					sectionContent = newComment + sectionContent.substring(commentEnd + 3);
				}
			}
		}
	} catch {
		// Non-critical — proceed without constrained layout
	}

	await ctx.updateProgress(__("Adding new section…", "wp-module-editor-chat"), 400);
	try {
		// The MCP schema exposes mutually-exclusive after_client_id / before_client_id.
		// Prefer before_client_id when set so "insert above X" requests land correctly.
		const beforeClientId = args.before_client_id || null;
		const afterClientId = args.after_client_id || null;
		const targetClientId = beforeClientId || afterClientId;
		const position = beforeClientId ? "before" : "after";
		const addResult = await handleAddAction(
			targetClientId,
			[{ block_content: sectionContent }],
			position
		);
		await ctx.updateProgress(__("Section added successfully", "wp-module-editor-chat"), 500);

		const resultData = {
			success: true,
			message: addResult.message,
			blocksAdded: addResult.blocksAdded,
		};

		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify(resultData),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (addError) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: addError.message }) }],
			isError: true,
		};
	}
}
