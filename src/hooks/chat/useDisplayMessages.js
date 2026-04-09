/**
 * useDisplayMessages — Transforms raw chat messages into display-ready format.
 *
 * Handles tool execution merging, failure notices, live augmentation,
 * and streaming text overlay.
 */
import { useMemo } from "@wordpress/element";

/**
 * Pure transformation of messages for display.
 * Exported separately for unit testing without React.
 *
 * @param {Array}  messages        Raw messages array
 * @param {string} currentResponse Streaming response text
 * @param {Object} activeToolCall  Currently executing tool call
 * @param {Array}  pendingTools    Tools waiting to execute
 * @param {Array}  executedTools   List of executed tools
 * @param {string} toolProgress    Tool progress message
 * @return {Array} Display-ready messages
 */
export function buildDisplayMessages(
	messages,
	currentResponse,
	activeToolCall,
	pendingTools,
	executedTools,
	toolProgress
) {
	let msgs = [...messages];

	// Hold back final assistant response while tools are executing
	const isToolsActive = !!activeToolCall || pendingTools.length > 0;
	if (isToolsActive && msgs.length > 0) {
		const last = msgs[msgs.length - 1];
		const isFinalResponse =
			(last.role === "assistant" || last.type === "assistant") &&
			!last.id?.includes("-reasoning") &&
			last.type !== "tool_execution";
		if (isFinalResponse) {
			msgs = msgs.slice(0, -1);
		}
	}

	// Amend final assistant message with tool failure notices
	if (!isToolsActive) {
		const failedTools = msgs
			.filter((m) => m.type === "tool_execution")
			.flatMap((m) => (m.executedTools || []).filter((t) => t.isError));
		if (failedTools.length > 0) {
			for (let i = msgs.length - 1; i >= 0; i--) {
				const m = msgs[i];
				if (
					(m.role === "assistant" || m.type === "assistant") &&
					m.type !== "tool_execution" &&
					!m.id?.includes("-reasoning") &&
					m.content
				) {
					const names = failedTools.map((t) => (t.name || "unknown").replace(/^blu-/, ""));
					const notice =
						failedTools.length === 1
							? `\n\n> **Note:** The **${names[0]}** action failed and was not applied.`
							: `\n\n> **Note:** The following actions failed and were not applied: **${names.join("**, **")}**.`;
					msgs = [...msgs.slice(0, i), { ...m, content: m.content + notice }, ...msgs.slice(i + 1)];
					break;
				}
			}
		}
	}

	// Merge consecutive tool_execution messages
	const merged = [];
	for (const msg of msgs) {
		const prev = merged[merged.length - 1];
		if (msg.type === "tool_execution" && prev?.type === "tool_execution") {
			merged[merged.length - 1] = {
				...prev,
				executedTools: [...(prev.executedTools || []), ...(msg.executedTools || [])],
				...(msg.hasActions ? { hasActions: true, undoData: msg.undoData } : {}),
			};
		} else {
			merged.push(msg);
		}
	}
	msgs = merged;

	// Augment tool_execution with live state
	const hasToolActivity = !!activeToolCall || pendingTools.length > 0 || executedTools.length > 0;
	if (hasToolActivity) {
		let lastUserIdx = -1;
		for (let i = msgs.length - 1; i >= 0; i--) {
			if (msgs[i].role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		let toolExecIdx = -1;
		for (let i = msgs.length - 1; i > lastUserIdx; i--) {
			if (msgs[i].type === "tool_execution") {
				toolExecIdx = i;
				break;
			}
		}

		const msgTools = toolExecIdx !== -1 ? msgs[toolExecIdx].executedTools || [] : [];
		const stateIds = new Set(executedTools.map((t) => t.id));
		const allExecuted = [...msgTools.filter((t) => !stateIds.has(t.id)), ...executedTools];

		const augmented = {
			id: toolExecIdx !== -1 ? msgs[toolExecIdx].id : "tool-exec-live",
			role: "assistant",
			type: "tool_execution",
			executedTools: allExecuted,
			activeToolCall,
			pendingTools,
			toolProgress,
			...(toolExecIdx !== -1 && msgs[toolExecIdx].hasActions
				? { hasActions: true, undoData: msgs[toolExecIdx].undoData }
				: {}),
			timestamp: toolExecIdx !== -1 ? msgs[toolExecIdx].timestamp : new Date(),
		};

		if (toolExecIdx !== -1) {
			msgs = [...msgs.slice(0, toolExecIdx), augmented, ...msgs.slice(toolExecIdx + 1)];
		} else {
			let insertIdx = msgs.length;
			for (let i = msgs.length - 1; i >= 0; i--) {
				if (msgs[i].role === "user") {
					insertIdx = i + 1;
					break;
				}
			}
			msgs = [...msgs.slice(0, insertIdx), augmented, ...msgs.slice(insertIdx)];
		}
	}

	// Streaming text overlay
	if (currentResponse) {
		return [
			...msgs,
			{
				id: "streaming-current",
				type: "assistant",
				role: "assistant",
				content: currentResponse,
			},
		];
	}

	return msgs;
}

/**
 * Hook wrapping buildDisplayMessages in useMemo.
 *
 * @param {Object} deps                 Message state dependencies
 * @param {Array}  deps.messages        Raw messages array
 * @param {string} deps.currentResponse Streaming response text
 * @param {Object} deps.activeToolCall  Currently executing tool call
 * @param {Array}  deps.pendingTools    Tools waiting to execute
 * @param {Array}  deps.executedTools   List of executed tools
 * @param {string} deps.toolProgress    Tool progress message
 * @return {Array} Display-ready messages
 */
const useDisplayMessages = ({
	messages,
	currentResponse,
	activeToolCall,
	pendingTools,
	executedTools,
	toolProgress,
}) => {
	return useMemo(
		() =>
			buildDisplayMessages(
				messages,
				currentResponse,
				activeToolCall,
				pendingTools,
				executedTools,
				toolProgress
			),
		[messages, currentResponse, activeToolCall, pendingTools, executedTools, toolProgress]
	);
};

export default useDisplayMessages;
