/**
 * Pure utility functions for conversation management.
 * No React dependencies — all functions are stateless and testable.
 */
import { MAX_SAME_TOOL_RETRIES, READ_ONLY_TOOLS } from "./constants";

/**
 * Parse the reasoning response to detect [PLAN] prefix.
 * Returns { isPlan, content } where content has the prefix stripped.
 *
 * @param {string} text Raw response text
 * @return {{ isPlan: boolean, content: string }} Parsed result with plan detection
 */
export function parseReasoningResponse(text) {
	const trimmed = (text || "").trim();
	if (trimmed.startsWith("[PLAN]")) {
		let content = trimmed.slice("[PLAN]".length).trim();

		// The model sometimes hallucinates function calls in the reasoning pass
		// (where tools are disabled).  Truncate at the first sign of tool-call
		// leakage so the user only sees the natural-language plan.
		const junkPatterns = [
			/\bto=functions\./i,
			/\{\s*"client_id"/,
			/\{\s*"block_content"/,
			/<!--\s*wp:/,
			/\{\s*"after_client_id"/,
		];
		for (const pattern of junkPatterns) {
			const match = content.search(pattern);
			if (match !== -1) {
				content = content.slice(0, match).trim();
				break;
			}
		}

		return { isPlan: true, content };
	}
	return { isPlan: false, content: trimmed };
}

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
 * Keeps the system prompt and current exchange (from last user message onward)
 * intact. For older messages:
 * - Strips embedded <editor_context> from legacy user messages
 * - Replaces tool_call arguments with compact stubs
 * - Aggressively truncates old tool result content
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

	const compressed = [];
	for (let i = 0; i < history.length; i++) {
		const msg = history[i];

		// Keep system prompt (idx 0) and current exchange intact
		if (i === 0 || i >= lastUserIdx) {
			compressed.push(msg);
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

	return compressed;
}

/**
 * Check if conversation has at least one meaningful user message.
 *
 * @param {Array} messages Messages array
 * @return {boolean} True if at least one user message has non-empty content.
 */
export function hasMeaningfulUserMessage(messages) {
	return messages.some(
		(m) => (m.role === "user" || m.type === "user") && m.content && String(m.content).trim()
	);
}

/**
 * Check if the user's message requires site management tools.
 * Uses the raw user message (not the AI's plan, which always mentions "page").
 * Matches explicit action + noun patterns to avoid false positives.
 * @param {string} userMessage The raw user message text
 * @return {boolean} True if message requires site management tools
 */
export function messageNeedsSiteTools(userMessage) {
	const msg = (userMessage || "").toLowerCase();
	return (
		/\b(create|write|publish|draft|make)\b.{0,15}\b(post|article|blog)\b/.test(msg) ||
		/\b(create|make)\b.{0,10}\b(new\s+)?page\b/.test(msg) ||
		/\b(upload|manage)\b.{0,10}\b(media|image|file)\b/.test(msg) ||
		/\b(add|create|manage|update|delete)\b.{0,10}\b(user|product|setting)\b/.test(msg) ||
		/\bwoocommerce\b/.test(msg)
	);
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
 * Create a retry tracker for the function-calling loop.
 * Encapsulates per-tool-name iteration counting and retry-limit detection.
 *
 * @param {number} maxRetries Max iterations of the same write tool before blocking
 * @return {{ recordIteration: Function }} Tracker with recordIteration method
 */
export function createRetryTracker(maxRetries = MAX_SAME_TOOL_RETRIES) {
	const toolNameCounts = new Map();
	let retryLimitHit = false;

	return {
		/**
		 * Record a batch of tool calls and check for retry limits.
		 *
		 * @param {Array} toolCalls Array of { name: string, ... }
		 * @return {{ allRetried: boolean, retryLimitHit: boolean }} Retry status flags
		 */
		recordIteration(toolCalls) {
			const writeToolsInBatch = new Set();
			for (const tc of toolCalls) {
				if (!READ_ONLY_TOOLS.has(tc.name)) {
					writeToolsInBatch.add(tc.name);
				}
			}
			for (const name of writeToolsInBatch) {
				toolNameCounts.set(name, (toolNameCounts.get(name) || 0) + 1);
			}
			const allRetried =
				writeToolsInBatch.size > 0 &&
				[...writeToolsInBatch].every((name) => toolNameCounts.get(name) > maxRetries);

			if (allRetried) {
				const wasAlreadyHit = retryLimitHit;
				retryLimitHit = true;
				return { allRetried: true, retryLimitHit: wasAlreadyHit };
			}

			return { allRetried: false, retryLimitHit: false };
		},
	};
}
