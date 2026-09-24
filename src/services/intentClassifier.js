/**
 * Classify user intent via the CF Worker /classify-intent endpoint.
 */
import { getCurrentPageTitle } from "../utils/editorHelpers";
import logger from "../utils/logger";

export const DEFAULT_INTENT = {
	task: "edit_page",
	content_type: null,
	layout: null,
	menu_edit: null,
	steps: [],
};

/**
 * Classify a user message and decompose it into the changes it asks for.
 *
 * @param {string}      message       User-facing message text
 * @param {Object}      sessionConfig Session config with workerUrl and sessionToken
 * @param {AbortSignal} [signal]      Turn abort signal, so Stop cancels this request
 * @return {Promise<{ task: string, content_type: string|null, layout: string|null, menu_edit: Object|null, steps: string[] }>} Classified intent
 */
export async function classifyUserIntent(message, sessionConfig, signal) {
	if (!message?.trim()) {
		return DEFAULT_INTENT;
	}

	const { workerUrl, sessionToken } = sessionConfig || {};
	if (!workerUrl || !sessionToken) {
		logger.warn("[IntentClassifier] Missing session config — defaulting to edit_page");
		return DEFAULT_INTENT;
	}

	const locale = window.nfdEditorChat?.site?.locale || undefined;
	let currentPageTitle;
	try {
		currentPageTitle = getCurrentPageTitle();
	} catch {
		currentPageTitle = undefined;
	}

	try {
		const response = await fetch(`${workerUrl.replace(/\/$/, "")}/classify-intent`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${sessionToken}`,
			},
			body: JSON.stringify({
				message,
				locale,
				context: currentPageTitle ? { current_page_title: currentPageTitle } : undefined,
			}),
			signal,
		});

		if (!response.ok) {
			logger.warn("[IntentClassifier] HTTP error:", response.status);
			return DEFAULT_INTENT;
		}

		const data = await response.json();
		if (!data?.task) {
			return DEFAULT_INTENT;
		}

		const steps = Array.isArray(data.steps) ? data.steps.filter(Boolean) : [];
		logger.log(
			"[IntentClassifier] Classified:",
			data.task,
			data.content_type,
			data.layout,
			data.menu_edit,
			steps
		);
		return {
			task: data.task,
			content_type: data.content_type ?? null,
			layout: normalizeIntentLayout(data.task, data.content_type, data.layout),
			menu_edit: data.menu_edit ?? null,
			steps,
		};
	} catch (err) {
		logger.warn("[IntentClassifier] Request failed:", err?.message || err);
		return DEFAULT_INTENT;
	}
}

/**
 * Normalize page layout from the classifier. Pages default to rich.
 *
 * @param {string}      task        Classified task.
 * @param {string|null} contentType Classified content type.
 * @param {string|null} layout      Raw layout field.
 * @return {string|null} "rich", "text_only", or null.
 */
function normalizeIntentLayout(task, contentType, layout) {
	if (task !== "create_content") {
		return null;
	}
	if (contentType === "post" || contentType === "cpt" || contentType === "product") {
		return null;
	}
	if (layout === "text_only") {
		return "text_only";
	}
	return "rich";
}

/**
 * Whether the intent requires all MCP site-management tools.
 *
 * @param {{ task: string }} intent Classified intent
 * @return {boolean} True when the full tool set should be sent
 */
export function intentNeedsAllTools(intent) {
	return intent?.task === "create_content" || intent?.task === "site_management";
}

/**
 * Pick the nudge for the first tool-calling pass based on classified intent.
 *
 * @param {{ task: string }} intent       Classified intent
 * @param {string}           executeNudge EXECUTE_NUDGE constant
 * @param {string}           jsonFormat   ASSISTANT_JSON_FORMAT constant
 * @param {string}           createNudge  CREATE_NUDGE constant
 * @return {string} Nudge to send with the first pass
 */
export function getIntentNudge(intent, executeNudge, jsonFormat, createNudge) {
	switch (intent?.task) {
		case "create_content":
			return createNudge || jsonFormat;
		case "conversational":
			return jsonFormat;
		case "site_management":
		case "edit_page":
		default:
			return executeNudge;
	}
}
