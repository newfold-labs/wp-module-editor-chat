/**
 * WordPress dependencies
 */
import apiFetch from "@wordpress/api-fetch";

/**
 * Internal dependencies
 */
import {
	getCurrentPageContent,
	getCurrentPageId,
	getCurrentPageTitle,
	getSelectedBlocks,
} from "../utils/editorHelpers";
import actionExecutor from "./actionExecutor";

/**
 * Chat API Service
 *
 * Handles all API calls for the editor chat functionality.
 * Uses WordPress REST API as a proxy to the remote AI service.
 */

/**
 * Build the context object with editor data
 *
 * @return {Object} The context object
 */
const buildContext = () => {
	return {
		page: {
			page_id: getCurrentPageId(),
			page_title: getCurrentPageTitle(),
			selected_blocks: getSelectedBlocks(),
			blocks: getCurrentPageContent(),
		},
	};
};

/**
 * Send a message to the chat API
 *
 * This function handles both creating a new conversation (if conversationId is not provided)
 * and sending messages to an existing conversation.
 *
 * @param {string|null} [conversationId] - The conversation ID (optional for new conversations)
 * @param {string}      message          - The user message
 * @return {Promise<Object>} The API response with conversationId and message
 */
export const sendMessage = async (conversationId, message) => {
	try {
		const requestData = {
			message,
			context: buildContext(),
		};

		// Only include conversationId if it exists
		if (conversationId) {
			requestData.conversationId = conversationId;
		}

		const response = await apiFetch({
			path: "/nfd-editor-chat/v1/chat",
			method: "POST",
			data: requestData,
		});

		// Execute actions if present
		if (response.actions && Array.isArray(response.actions)) {
			try {
				const actionResult = await actionExecutor.executeActions(response.actions);
				response.actionExecutionResult = actionResult;
			} catch (error) {
				// eslint-disable-next-line no-console
				console.error("Error executing actions:", error);
				response.actionExecutionResult = {
					success: false,
					error: error.message,
				};
			}
		}

		return response;
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error sending message:", error);
		throw error;
	}
};
