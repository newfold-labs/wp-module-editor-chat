/**
 * Classify user intent via the CF Worker /classify-intent endpoint.
 */
import { getCurrentPageTitle } from "../utils/editorHelpers";
import logger from "../utils/logger";

export const DEFAULT_INTENT = {
	task: "edit_page",
	content_type: null,
};

/**
 * @param {string} message User-facing message text
 * @param {Object} sessionConfig Session config with workerUrl and sessionToken
 * @return {Promise<{ task: string, content_type: string|null }>}
 */
export async function classifyUserIntent(message, sessionConfig) {
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
		});

		if (!response.ok) {
			logger.warn("[IntentClassifier] HTTP error:", response.status);
			return DEFAULT_INTENT;
		}

		const data = await response.json();
		if (!data?.task) {
			return DEFAULT_INTENT;
		}

		logger.log("[IntentClassifier] Classified:", data.task, data.content_type);
		return {
			task: data.task,
			content_type: data.content_type ?? null,
		};
	} catch (err) {
		logger.warn("[IntentClassifier] Request failed:", err?.message || err);
		return DEFAULT_INTENT;
	}
}

/**
 * Whether the intent requires all MCP site-management tools.
 *
 * @param {{ task: string }} intent Classified intent
 * @return {boolean}
 */
export function intentNeedsAllTools(intent) {
	return intent?.task === "create_content" || intent?.task === "site_management";
}

/**
 * Pick the nudge for the first tool-calling pass based on classified intent.
 *
 * @param {{ task: string }} intent Classified intent
 * @param {string} executeNudge EXECUTE_NUDGE constant
 * @param {string} jsonFormat ASSISTANT_JSON_FORMAT constant
 * @return {string}
 */
export function getIntentNudge(intent, executeNudge, jsonFormat) {
	switch (intent?.task) {
		case "create_content":
		case "conversational":
			return jsonFormat;
		case "site_management":
		case "edit_page":
		default:
			return executeNudge;
	}
}
