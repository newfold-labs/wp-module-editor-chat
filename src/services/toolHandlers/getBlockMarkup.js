import { __ } from "@wordpress/i18n";

import { getBlockMarkup } from "../../utils/editorHelpers";

export async function handleGetBlockMarkup(toolCall, args, ctx) {
	await ctx.updateProgress(__("Reading block markup…", "wp-module-editor-chat"), 300);
	const markupResult = getBlockMarkup(args.client_id);
	if (markupResult) {
		return {
			id: toolCall.id,
			result: [{ type: "text", text: JSON.stringify(markupResult) }],
			isError: false,
		};
	}
	return {
		id: toolCall.id,
		result: [
			{
				type: "text",
				text: JSON.stringify({
					error: `Block with clientId ${args.client_id} not found`,
				}),
			},
		],
		isError: true,
	};
}
