/**
 * useDisplayMessages — Transforms raw chat messages into display-ready format.
 *
 * Handles tool execution merging, live augmentation, and streaming text
 * overlay. Tool failures are reported to the dev console (see the hook below)
 * rather than surfaced in the chat UI.
 */
import { useEffect, useMemo, useRef } from "@wordpress/element";

import logger from "../../utils/logger";

/**
 * Parse a tool call's `arguments` into a plain object, tolerating both the
 * object and JSON-string forms the model emits.
 *
 * @param {*} raw The raw `arguments` value from an executed-tool entry.
 * @return {Object} Parsed args, or `{}` when absent/unparseable.
 */
function readToolArgs(raw) {
	if (!raw) {
		return {};
	}
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw);
		} catch {
			return {};
		}
	}
	return typeof raw === "object" ? raw : {};
}

/**
 * Derive a stable identity for an executed tool so a failed attempt and its
 * successful retry compare equal. Combines the normalized ability name with the
 * target block, unwrapping the `blu-call-ability` envelope (whose `parameters`
 * may itself be a JSON string) to reach the real `client_id`.
 *
 * @param {Object} entry An executed-tool entry ({ name, arguments, isError }).
 * @return {string} `name::target` key.
 */
function toolActionKey(entry) {
	const name = (entry.name || "unknown").replace(/\//g, "-");
	let args = readToolArgs(entry.arguments);
	if (args.ability_name !== undefined) {
		args = readToolArgs(args.parameters);
	}
	const target =
		args.client_id || args.clientId || args.parent_client_id || args.target_client_id || "";
	return `${name}::${target}`;
}

/**
 * Drop failed tool entries that a later attempt of the same action recovered
 * from. A failure the model already retried successfully is noise — surfacing it
 * makes a completed turn read as "Some actions failed". Order is preserved and
 * only failures *superseded by a later success* are removed; standalone failures
 * (no successful retry) stay visible.
 *
 * @param {Array} tools Ordered executed-tool entries for one tool_execution message.
 * @return {Array} Filtered list (same array when nothing is collapsed).
 */
export function collapseSupersededFailures(tools) {
	if (!Array.isArray(tools) || tools.length < 2) {
		return tools;
	}
	let changed = false;
	const kept = tools.filter((tool, i) => {
		if (!tool.isError) {
			return true;
		}
		const key = toolActionKey(tool);
		for (let j = i + 1; j < tools.length; j++) {
			if (!tools[j].isError && toolActionKey(tools[j]) === key) {
				changed = true;
				return false;
			}
		}
		return true;
	});
	return changed ? kept : tools;
}

// Gateway discovery tools are internal plumbing — the model calls them to find
// abilities and read their schemas. They aren't user-facing actions, so they're
// hidden from the "Actions completed" list.
const INTERNAL_TOOL_NAMES = new Set(["blu-list-abilities", "blu-get-ability-schema"]);

/**
 * Whether an executed-tool entry is internal plumbing that shouldn't be shown in
 * the actions list (tolerates the slash form some models emit).
 *
 * @param {Object} entry An executed-tool entry.
 * @return {boolean} True when the entry should be hidden from display.
 */
function isInternalTool(entry) {
	return INTERNAL_TOOL_NAMES.has((entry?.name || "").replace(/\//g, "-"));
}

/**
 * Pure transformation of messages for display.
 * Exported separately for unit testing without React.
 *
 * @param {Array}  messages       Raw messages array
 * @param {Object} activeToolCall Currently executing tool call
 * @param {Array}  pendingTools   Tools waiting to execute
 * @param {Array}  executedTools  List of executed tools
 * @param {string} toolProgress   Tool progress message
 * @return {Array} Display-ready messages
 */
export function buildDisplayMessages(
	messages,
	activeToolCall,
	pendingTools,
	executedTools,
	toolProgress
) {
	let msgs = [...messages];

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

	// Show only the FIRST plan preamble per turn. chatLoop already gates this when
	// emitting, but enforce it here too so a stray repeat ("I'll do X" restated on
	// a later tool pass) can never render as a duplicate message. Plan messages are
	// tagged with an id ending in "-plan"; the flag resets on each user turn.
	const deduped = [];
	let planSeenThisTurn = false;
	for (const m of msgs) {
		if (m.role === "user" || m.type === "user") {
			planSeenThisTurn = false;
			deduped.push(m);
			continue;
		}
		const isPlan = typeof m.id === "string" && m.id.endsWith("-plan");
		if (isPlan && planSeenThisTurn) {
			continue;
		}
		if (isPlan) {
			planSeenThisTurn = true;
		}
		deduped.push(m);
	}
	msgs = deduped;

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
			// Insert after the last message (before streaming overlay).
			// This ensures reasoning messages stay above the tool execution widget.
			msgs = [...msgs, augmented];
		}
	}

	// Clean up the executed-tools list for display: drop internal discovery calls
	// (ability list/schema), then collapse failures a later retry recovered from so
	// a turn that ultimately succeeded doesn't read as "Some actions failed". Both
	// are display-only — the conversation sent to the model is untouched.
	msgs = msgs.map((m) =>
		m.type === "tool_execution" && m.executedTools
			? {
					...m,
					executedTools: collapseSupersededFailures(
						m.executedTools.filter((t) => !isInternalTool(t))
					),
				}
			: m
	);

	return msgs;
}

/**
 * Collect tool failures from the current turn — i.e. messages after the last
 * user message — so reporting reflects only the active turn rather than
 * accumulating failures from the whole conversation history.
 *
 * @param {Array} messages Raw messages array
 * @return {{lastUserIdx: number, names: string[]}} Turn boundary and failed action names
 */
export function collectCurrentTurnFailures(messages) {
	let lastUserIdx = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") {
			lastUserIdx = i;
			break;
		}
	}
	const names = messages
		.slice(lastUserIdx + 1)
		.filter((m) => m.type === "tool_execution")
		.flatMap((m) => (m.executedTools || []).filter((t) => t.isError))
		.map((t) => (t.name || "unknown").replace(/^blu-/, ""));
	return { lastUserIdx, names };
}

/**
 * Hook wrapping buildDisplayMessages in useMemo.
 *
 * @param {Object} deps                Message state dependencies
 * @param {Array}  deps.messages       Raw messages array
 * @param {Object} deps.activeToolCall Currently executing tool call
 * @param {Array}  deps.pendingTools   Tools waiting to execute
 * @param {Array}  deps.executedTools  List of executed tools
 * @param {string} deps.toolProgress   Tool progress message
 * @return {Array} Display-ready messages
 */
const useDisplayMessages = ({
	messages,
	activeToolCall,
	pendingTools,
	executedTools,
	toolProgress,
}) => {
	const isToolsActive = !!activeToolCall || pendingTools.length > 0;
	const loggedFailureRef = useRef("");

	// Dev-only: report tool failures to the console instead of the chat UI.
	// Scoped to the current turn and de-duped so each turn logs at most once.
	// The production guard lets the bundler dead-code-eliminate this branch.
	useEffect(() => {
		if (process.env.NODE_ENV === "production" || isToolsActive) {
			return;
		}
		const { lastUserIdx, names } = collectCurrentTurnFailures(messages);
		if (names.length === 0) {
			loggedFailureRef.current = "";
			return;
		}
		const signature = `${lastUserIdx}:${names.join(",")}`;
		if (signature === loggedFailureRef.current) {
			return;
		}
		loggedFailureRef.current = signature;
		logger.warn(
			`[EditorChat] ${names.length} tool action(s) failed and were not applied: ${names.join(", ")}`
		);
	}, [messages, isToolsActive]);

	return useMemo(
		() => buildDisplayMessages(messages, activeToolCall, pendingTools, executedTools, toolProgress),
		[messages, activeToolCall, pendingTools, executedTools, toolProgress]
	);
};

export default useDisplayMessages;
