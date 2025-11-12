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
	getSelectedBlock,
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

const buildContext = async () => {
	return {
		page: {
			page_id: getCurrentPageId(),
			page_title: getCurrentPageTitle(),
			selected_block: getSelectedBlock(),
			content: await getCurrentPageContent(),
		},
	};
};

/**
 * Create a new conversation
 *
 * @return {Promise<Object>} The API response with conversationId
 */
export const createNewConversation = async () => {
	try {
		const response = await apiFetch({
			path: "/nfd-editor-chat/v1/chat/new",
			method: "POST",
		});

		return response;
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error creating new conversation:", error);
		throw error;
	}
};

/**
 * Send a message to the chat API
 *
 * This function sends messages to an existing conversation.
 * Returns a message_id that can be used to check status.
 *
 * @param {string} conversationId - The conversation ID (required)
 * @param {string} message        - The user message
 * @return {Promise<Object>} The API response with message_id
 */
export const sendMessage = async (conversationId, message) => {
	try {
		// eslint-disable-next-line no-console
		console.log("sendMessage: Starting API call");
		const requestData = {
			message,
			context: await buildContext(),
			conversationId,
		};

		// eslint-disable-next-line no-console
		console.log("sendMessage: Request data prepared, calling API");
		const response = await apiFetch({
			path: "/nfd-editor-chat/v1/chat",
			method: "POST",
			data: requestData,
		});

		// eslint-disable-next-line no-console
		console.log("sendMessage: API response received:", response);
		// The API now returns message_id immediately (202 status)
		return response;
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error sending message:", error);
		throw error;
	}
};

/**
 * Check the status of a chat message
 *
 * @param {string} messageId - The message ID to check status for
 * @return {Promise<Object>} The API response with status and optionally data
 */
export const checkStatus = async (messageId) => {
	try {
		// eslint-disable-next-line no-console
		console.log("checkStatus: Calling API with message_id:", messageId);
		const response = await apiFetch({
			path: "/nfd-editor-chat/v1/chat/status",
			method: "POST",
			data: {
				message_id: messageId,
			},
		});

		// eslint-disable-next-line no-console
		console.log("checkStatus: API response:", response);
		return response;
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error checking status:", error);
		throw error;
	}
};
