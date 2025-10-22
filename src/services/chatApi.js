/**
 * WordPress dependencies
 */
import apiFetch from "@wordpress/api-fetch";
import { select } from "@wordpress/data";

/**
 * Chat API Service
 *
 * Handles all API calls for the editor chat functionality.
 * Uses WordPress REST API as a proxy to the remote AI service.
 */

/**
 * Get the current page content (all blocks)
 *
 * @return {Object} The page content with both raw grammar and structured blocks
 */
const getCurrentPageContent = () => {
	const blockEditor = select("core/block-editor");

	const blocks = blockEditor.getBlocks();

	// Process blocks to get inner content for post-content and template-part blocks
	const processedBlocks = blocks.map((block) => {
		if (block.name === "core/post-content" || block.name === "core/template-part") {
			return {
				...block,
				innerBlocks: blockEditor.getBlocks(block.clientId),
			};
		}
		return block;
	});

	return {
		blocks: processedBlocks,
	};
};

/**
 * Get the current page ID
 *
 * @return {number} The page ID
 */
const getCurrentPageId = () => {
	const editor = select("core/editor");
	return editor.getCurrentPostId();
};

/**
 * Get the currently selected block
 *
 * @return {Object|null} The selected block or null
 */
const getSelectedBlock = () => {
	const blockEditor = select("core/block-editor");
	const selectedBlockClientId = blockEditor.getSelectedBlockClientId();

	if (selectedBlockClientId) {
		return blockEditor.getBlock(selectedBlockClientId);
	}

	return null;
};

/**
 * Build the context object with editor data
 *
 * @return {Object} The context object
 */
const buildContext = () => {
	const pageContent = getCurrentPageContent();

	// Extract template parts for processing
	const templateParts = pageContent.blocks.filter((block) => block.isTemplatePart);

	return {
		pageContent: {
			...pageContent,
			templateParts: templateParts.map((block) => ({
				slug: block.attributes.slug,
				theme: block.attributes.theme,
				area: block.attributes.area,
				clientId: block.clientId,
			})),
		},
		pageId: getCurrentPageId(),
		selectedBlock: getSelectedBlock(),
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

		return response;
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error("Error sending message:", error);
		throw error;
	}
};
