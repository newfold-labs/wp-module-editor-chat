export const CHAT_SEND_EVENT = "nfd:chat:send";

/**
 * Dispatch a message to the chat sidebar from outside the React tree
 * (e.g. from the block toolbar popover).
 *
 * @param {string} message
 * @param          clientId
 */
export function sendToChat(message, clientId) {
	window.dispatchEvent(new CustomEvent(CHAT_SEND_EVENT, { detail: { message, clientId } }));
}
