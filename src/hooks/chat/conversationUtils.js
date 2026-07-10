/**
 * Pure utility functions for conversation management.
 * No React dependencies — all functions are stateless and testable.
 */
import {
	MAX_SAME_TOOL_RETRIES,
	MAX_HISTORY_MESSAGES,
	MAX_HISTORY_CHARS,
	READ_ONLY_TOOLS,
} from "./constants";
import logger from "../../utils/logger";

/**
 * Truncate tool result content to keep conversation history lean.
 * Preserves enough for the AI to understand what happened.
 *
 * @param {string} content Raw tool result content
 * @param {number} maxLen  Maximum characters to keep
 * @return {string} Possibly truncated content
 */
export function truncateToolResult(content, maxLen = 500) {
	if (!content || content.length <= maxLen) {
		return content;
	}
	return content.slice(0, maxLen) + "\n...[truncated]";
}

/**
 * Compress conversation history to reduce token usage on subsequent API calls.
 *
 * Phase 1 (light): Keeps system prompt (idx 0) and current exchange intact.
 * For older messages: strips editor context, truncates tool results, stubs
 * tool_call args, and drops intermediate system messages.
 *
 * Phase 2 (aggressive): If still over message-count or char budget, collapses
 * old exchanges into compact user + assistant-summary pairs and drops the
 * oldest when necessary.
 *
 * @param {Array} history Conversation history array
 * @return {Array} Compressed history
 */
export function compressConversationHistory(history) {
	if (history.length <= 6) {
		return history;
	}

	// Find last user message — everything from there onward is "current"
	let lastUserIdx = -1;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === "user") {
			lastUserIdx = i;
			break;
		}
	}

	if (lastUserIdx <= 1) {
		return history;
	}

	// Phase 1: Light compression + drop old intermediate system messages
	const compressed = [];
	for (let i = 0; i < history.length; i++) {
		const msg = history[i];

		// Keep system prompt (idx 0) and current exchange intact
		if (i === 0 || i >= lastUserIdx) {
			compressed.push(msg);
			continue;
		}

		// Drop old intermediate system messages (e.g. "All tool calls above succeeded.")
		if (msg.role === "system") {
			continue;
		}

		if (msg.role === "user" && msg.content) {
			// Strip embedded editor context from older user messages
			const stripped = msg.content
				.replace(/<editor_context>[\s\S]*?<\/editor_context>\s*/g, "")
				.trim();
			compressed.push({ ...msg, content: stripped || msg.content });
		} else if (msg.role === "assistant" && msg.tool_calls) {
			// Strip detailed tool_call arguments (keep names for context)
			compressed.push({
				...msg,
				tool_calls: msg.tool_calls.map((tc) => ({
					...tc,
					function: {
						...tc.function,
						arguments: "{}",
					},
				})),
			});
		} else if (msg.role === "tool") {
			// Aggressively truncate older tool results
			compressed.push({
				...msg,
				content: truncateToolResult(msg.content, 150),
			});
		} else {
			compressed.push(msg);
		}
	}

	// Phase 2: If still over budget, collapse old exchanges aggressively
	if (
		compressed.length > MAX_HISTORY_MESSAGES ||
		estimateHistoryChars(compressed) > MAX_HISTORY_CHARS
	) {
		return collapseOldExchanges(compressed);
	}

	return compressed;
}

/**
 * Collapse old exchanges into compact user + assistant-summary pairs.
 * Drops tool_calls, tool results, and keeps only the final text response
 * per exchange. Drops oldest pairs first if the result is still over budget.
 *
 * @param {Array} history Already light-compressed history
 * @return {Array} Aggressively collapsed history
 */
function collapseOldExchanges(history) {
	let lastUserIdx = -1;
	for (let i = history.length - 1; i >= 0; i--) {
		if (history[i].role === "user") {
			lastUserIdx = i;
			break;
		}
	}

	const systemPrompt = history[0];
	const currentExchange = history.slice(lastUserIdx);
	const oldMessages = history.slice(1, lastUserIdx);

	// Walk old messages and keep only user + last text-only assistant per exchange
	const collapsed = [];
	let i = 0;
	while (i < oldMessages.length) {
		if (oldMessages[i].role === "user") {
			const userContent = oldMessages[i].content || "";
			collapsed.push({
				role: "user",
				content: userContent.length > 200 ? userContent.slice(0, 200) + "..." : userContent,
			});

			// Scan forward for the last text-only assistant response in this exchange
			let lastSummary = "";
			let j = i + 1;
			while (j < oldMessages.length && oldMessages[j].role !== "user") {
				if (
					oldMessages[j].role === "assistant" &&
					!oldMessages[j].tool_calls &&
					oldMessages[j].content
				) {
					lastSummary = oldMessages[j].content;
				}
				j++;
			}
			if (lastSummary) {
				collapsed.push({
					role: "assistant",
					content: lastSummary.length > 200 ? lastSummary.slice(0, 200) + "..." : lastSummary,
				});
			}
			i = j;
		} else {
			i++;
		}
	}

	let result = [systemPrompt, ...collapsed, ...currentExchange];

	// Drop oldest collapsed pairs if still over char budget
	while (estimateHistoryChars(result) > MAX_HISTORY_CHARS && collapsed.length >= 2) {
		// Remove oldest pair (user + optional assistant)
		const drop = collapsed[1]?.role === "assistant" ? 2 : 1;
		collapsed.splice(0, drop);
		result = [systemPrompt, ...collapsed, ...currentExchange];
	}

	logger.log(`[EditorChat] History collapsed: ${history.length} → ${result.length} messages`);
	return result;
}

/**
 * Estimate total character count of a message array.
 * Counts message content and serialized tool_calls.
 *
 * @param {Array} messages Conversation messages
 * @return {number} Approximate character count
 */
function estimateHistoryChars(messages) {
	return messages.reduce((sum, m) => {
		let chars = m.content ? m.content.length : 0;
		if (m.tool_calls) {
			chars += JSON.stringify(m.tool_calls).length;
		}
		return sum + chars;
	}, 0);
}

/**
 * Convert MCP tools to OpenAI function-calling format.
 *
 * @param {Array} mcpTools Tools from mcpClient.listTools()
 * @return {Array} OpenAI tools array
 */
export function mcpToolsToOpenAI(mcpTools) {
	return mcpTools.map((tool) => ({
		type: "function",
		function: {
			name: (tool.name || "").replace(/\//g, "-"),
			description: tool.description || "",
			parameters: tool.inputSchema || { type: "object", properties: {} },
		},
	}));
}

/**
 * Stable, recursive JSON-ish serialization for use as a map key. Sorts
 * object keys so {a:1,b:2} and {b:2,a:1} produce the same string. Used by
 * the retry tracker to distinguish tool calls with different arguments.
 *
 * @param {*} value Any JSON-safe value
 * @return {string} Deterministic string representation
 */
function stableArgsHash(value) {
	if (value === null || value === undefined) {
		return "";
	}
	if (typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return "[" + value.map(stableArgsHash).join(",") + "]";
	}
	const keys = Object.keys(value).sort();
	return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableArgsHash(value[k])).join(",") + "}";
}

/**
 * Create a retry tracker for the function-calling loop.
 *
 * Tracks how many times each (tool name + serialized arguments) pair has
 * been called. A call only counts as a "retry" when the AI invokes the
 * exact same tool with the exact same arguments more than `maxRetries`
 * times — which is the actual pathology we want to catch (stuck loops).
 * Different arguments = different work, never a retry.
 *
 * Read-only tools are exempt entirely: their repeated calls are either
 * idempotent or intentionally targeting different resources.
 *
 * @param {number} maxRetries Max repeats of the same (tool, args) before blocking
 * @return {{ recordIteration: Function }} Tracker with recordIteration method
 */
export function createRetryTracker(maxRetries = MAX_SAME_TOOL_RETRIES) {
	const callCounts = new Map(); // key: `${name}:${argsHash}`
	let retryLimitHit = false;

	return {
		/**
		 * Record a batch of tool calls and check for retry limits.
		 *
		 * @param {Array} toolCalls Array of { name: string, arguments: object, ... }
		 * @return {{ allRetried: boolean, retryLimitHit: boolean }} Retry status flags
		 */
		recordIteration(toolCalls) {
			const batchKeys = new Set();
			for (const tc of toolCalls) {
				if (READ_ONLY_TOOLS.has(tc.name)) {
					continue;
				}
				const key = `${tc.name}:${stableArgsHash(tc.arguments)}`;
				batchKeys.add(key);
			}
			for (const key of batchKeys) {
				callCounts.set(key, (callCounts.get(key) || 0) + 1);
			}
			const allRetried =
				batchKeys.size > 0 && [...batchKeys].every((key) => callCounts.get(key) > maxRetries);

			if (allRetried) {
				const wasAlreadyHit = retryLimitHit;
				retryLimitHit = true;
				return { allRetried: true, retryLimitHit: wasAlreadyHit };
			}

			return { allRetried: false, retryLimitHit: false };
		},
	};
}

/**
 * Append attachment context to the user message for the AI.
 * Only "ready" attachments with a URL are included.
 *
 * @param {string} message     - The raw user message.
 * @param {Array}  attachments - Attachment objects from ChatInput state.
 * @return {string} The enriched message.
 */
export function buildMessageWithAttachments(message, attachments) {
	const ready = attachments.filter((att) => att.status === "ready" && att.url);
	if (ready.length === 0) {
		return message;
	}

	const images = ready.filter((att) => att.type.startsWith("image/"));
	const documents = ready.filter((att) => !att.type.startsWith("image/"));

	// Sanitize filenames before interpolating into the AI context string to prevent
	// prompt injection via crafted filenames (strip newlines, limit length).
	const safeName = (name) =>
		String(name || "")
			.replace(/[\r\n\t]/g, " ")
			.trim()
			.slice(0, 128);

	let context = "";

	if (images.length > 0) {
		context += "\n\n[User uploaded images]\n";
		context += images.map((att) => `- ${safeName(att.name)}: ${att.url}`).join("\n");
		if (documents.length === 0) {
			context +=
				"\n\nGuidance for uploaded images:" +
				"\n- To apply colors from an uploaded image to the site palette: call blu/extract-image-colors(image_url=<url>) to get the dominant hex, then call blu/generate-color-palette(prompt='palette based on <hex> color') to generate a full palette, present the options to the user, and apply the chosen one with blu/update-global-styles. NEVER guess colors from filenames or descriptions." +
				"\n- To blend/edit a block image: use the URL as reference_url in blu/edit-image." +
				"\n- To replace the site logo (two mandatory steps in order):" +
				"\n  Step 1: call blu/edit-image(source_url=<uploaded_url>, prompt='remove background and trim whitespace', background:transparent, trim:true)" +
				"\n  Step 2: call blu/set-logo-from-image(source_url=<url_returned_by_step_1>) — use the URL from Step 1, not the original uploaded URL.";
		}
	}

	if (documents.length > 0) {
		context += "\n\n[User uploaded documents]\n";
		context += documents.map((att) => `- ${safeName(att.name)}: ${att.url}`).join("\n");
		context +=
			"\n\nGuidance for uploaded documents:" +
			"\n- To replace text content in blocks: call blu/read-document(source_url=<url>), then use blu/edit-block to set the new inner content. Do NOT use blu/update-block-attrs for text — that tool only changes non-content attributes (color, alignment, etc.)." +
			"\n- If the user has a block selected, update that block. If it is a container (Group, Cover, etc.), find the paragraph or heading children inside it and edit those." +
			"\n- After updating ALL the text content of a section from a document: call blu/update-block-attrs on the container block to strip animation classes (nfd-wb-*, nfd-delay-*) from its className. This applies even if the NFD class reference lists those classes as preserved — document-based full-section replacement is the explicit exception." +
			"\n- CSV files contain tabular data. When the user uploads a CSV: read it with blu/read-document, parse the rows/columns, then:" +
			"\n  • If a core/table block already exists on the page or is selected → update it with blu/edit-block using this markup template:" +
			'\n    <!-- wp:table --><figure class="wp-block-table"><table><thead><tr><th>Col1</th><th>Col2</th></tr></thead><tbody><tr><td>val</td><td>val</td></tr></tbody></table></figure><!-- /wp:table -->' +
			"\n  • If no table exists → insert one with blu/add-section at an appropriate position on the page." +
			"\n  • If the CSV data maps better to cards or a grid (e.g. team members, service cards) than to a plain table, build the appropriate block structure instead and explain the choice." +
			"\n- Otherwise find the most relevant text blocks from the page's block tree and update them.";
	}

	if (images.length > 0 && documents.length > 0) {
		context +=
			"\n\nGuidance for combined images + document uploads:" +
			"\n- The uploaded images are content assets (portraits, product photos, illustrations) to be placed directly into blocks — do NOT call blu/edit-image on them." +
			"\n- Match each image to the corresponding document row using this priority:" +
			"\n  1. If the CSV has a column named Photo, Image, or Filename → match the uploaded filename (strip extension) against that column value (strip extension). This is the preferred approach." +
			"\n  2. Otherwise fall back to comparing the filename (strip extension, replace hyphens/underscores with spaces) against the Name field. Example: 'giorgio-ferretti.jpg' → 'Giorgio Ferretti'." +
			"\n- The name shown before the colon is the original filename; the URL after the colon is the actual URL to use." +
			"\n- Use the matched URL directly as the url attribute of a core/image block — no processing or generation needed:" +
			'\n  <!-- wp:image {"sizeSlug":"full"} --><figure class="wp-block-image size-full"><img src="<matched_url>" alt="<person name or description>"/></figure><!-- /wp:image -->' +
			"\n- If a filename does not clearly match any document row, place that image at the end or omit it and note the mismatch.";
	}

	return message + context;
}
