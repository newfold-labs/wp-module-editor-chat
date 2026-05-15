import { __ } from "@wordpress/i18n";

import { validateBlockMarkup } from "../../utils/blockValidator";
import { handleInsertInnerBlockAction } from "../blockActions";

export async function handleInsertInnerBlock(toolCall, args, ctx) {
	await ctx.updateProgress(__("Inserting block…", "wp-module-editor-chat"), 400);
	try {
		// Strip escaped quotes the LLM may copy from JSON-encoded tool results
		const markup = (args.block_content || "").replace(/\\"/g, '"');
		const validation = validateBlockMarkup(markup);
		if (!validation.valid) {
			return {
				id: toolCall.id,
				result: [
					{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) },
				],
				isError: true,
			};
		}
		const finalMarkup = validation.correctedContent || markup;
		const index = typeof args.index === "number" ? args.index : null;
		const insResult = await handleInsertInnerBlockAction(args.parent_client_id, finalMarkup, index);
		await ctx.updateProgress(__("Block inserted successfully", "wp-module-editor-chat"), 500);
		return {
			id: toolCall.id,
			result: [
				{
					type: "text",
					text: JSON.stringify({
						success: true,
						message: insResult.message,
						inserted_client_ids: insResult.insertedClientIds,
					}),
				},
			],
			isError: false,
			hasChanges: true,
		};
	} catch (insError) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify({ success: false, error: insError.message }) }],
			isError: true,
		};
	}
}
