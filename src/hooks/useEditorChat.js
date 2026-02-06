/* eslint-disable no-undef, no-console */
/**
 * WordPress dependencies
 */
import { store as coreStore } from "@wordpress/core-data";
import { useDispatch, useSelect } from "@wordpress/data";
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies - from wp-module-ai-chat
 */
import {
	CHAT_STATUS,
	createMCPClient,
	createOpenAIClient,
	simpleHash,
} from "@newfold-labs/wp-module-ai-chat";

/**
 * Internal dependencies
 */
import actionExecutor from "../services/actionExecutor";
import { getCurrentGlobalStyles, updateGlobalStyles } from "../services/globalStylesService";
import {
	buildCompactBlockTree,
	getBlockMarkup,
	getCurrentPageBlocks,
	getCurrentPageTitle,
	getCurrentPageId,
	getSelectedBlocks,
} from "../utils/editorHelpers";
import { validateBlockMarkup } from "../utils/blockValidator";

// Create editor-specific clients with the editor config
const mcpClient = createMCPClient({ configKey: "nfdEditorChat" });
const openaiClient = createOpenAIClient({
	configKey: "nfdEditorChat",
	apiPath: "",
	mode: "editor",
});

/**
 * Get site-specific localStorage keys for chat persistence
 *
 * @return {Object} Storage keys object with site-specific keys
 */
const getStorageKeys = () => {
	const siteId = simpleHash(window.nfdEditorChat?.homeUrl || "default");
	return {
		SESSION_ID: `nfd-editor-chat-session-id-${siteId}`,
		MESSAGES: `nfd-editor-chat-messages-${siteId}`,
	};
};

/**
 * Load session ID from localStorage
 *
 * @return {string|null} The session ID or null
 */
const loadSessionId = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		return localStorage.getItem(STORAGE_KEYS.SESSION_ID);
	} catch (error) {
		console.warn("Failed to load session ID from localStorage:", error);
		return null;
	}
};

/**
 * Save session ID to localStorage
 *
 * @param {string} sessionId The session ID to save
 */
const saveSessionId = (sessionId) => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		if (sessionId) {
			localStorage.setItem(STORAGE_KEYS.SESSION_ID, sessionId);
		} else {
			localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
		}
	} catch (error) {
		console.warn("Failed to save session ID to localStorage:", error);
	}
};

/**
 * Load messages from localStorage
 *
 * @return {Array} Array of messages
 */
const loadMessages = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		const stored = localStorage.getItem(STORAGE_KEYS.MESSAGES);
		if (stored) {
			const messages = JSON.parse(stored);
			return messages
				.map((msg) => {
					const { hasActions, undoData, isStreaming, ...rest } = msg;
					return rest;
				})
				.filter((msg) => {
					if (msg.type === "user") {
						return true;
					}
					const hasContent = msg.content !== null && msg.content !== "";
					const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;
					return hasContent || hasToolCalls;
				});
		}
		return [];
	} catch (error) {
		console.warn("Failed to load messages from localStorage:", error);
		return [];
	}
};

/**
 * Save messages to localStorage
 *
 * @param {Array} messages Array of messages to save
 */
const saveMessages = (messages) => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		const cleanMessages = messages.map(({ isStreaming, ...rest }) => rest);
		localStorage.setItem(STORAGE_KEYS.MESSAGES, JSON.stringify(cleanMessages));
	} catch (error) {
		console.warn("Failed to save messages to localStorage:", error);
	}
};

/**
 * Clear all chat data from localStorage
 */
const clearChatData = () => {
	try {
		const STORAGE_KEYS = getStorageKeys();
		localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
		localStorage.removeItem(STORAGE_KEYS.MESSAGES);
	} catch (error) {
		console.warn("Failed to clear chat data from localStorage:", error);
	}
};

/**
 * Generate a new session ID
 *
 * @return {string} New session ID
 */
const generateSessionId = () => {
	return crypto.randomUUID
		? crypto.randomUUID()
		: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

/**
 * System prompt sent with every editor chat request.
 * Instructs the AI on available tools, context format, and block editing rules.
 */
const EDITOR_SYSTEM_PROMPT = `You are a WordPress site editor assistant. You help users modify their page by editing blocks, adding sections, moving content, and changing styles.

## Available Tools
- blu/edit-block: Replace a block's content with new markup
- blu/add-section: Insert new blocks at a position
- blu/delete-block: Remove a block
- blu/move-block: Reorder blocks
- blu/get-block-markup: Fetch full markup of a block before editing
- blu/update-global-styles: Change site-wide colors, typography, spacing
- blu/highlight-block: Select and flash a block to show the user where it is
- blu/get-global-styles: Read current global styles

## Context Format
Each message includes <editor_context> with:
- Page info (title, ID)
- A compact block tree showing all blocks with their clientId and text preview
- Full markup for every block marked [SELECTED] (one or more)

## Rules
1. SELECTED BLOCKS: Blocks marked [SELECTED] in the block tree are the ones the user has selected. Their full markup is provided below the tree. When the user says "this", "these", "it", "them", "that", or similar pronouns, they mean the [SELECTED] block(s). When multiple blocks are selected the user may want changes applied to all of them — use context to decide. If no block is selected and the user uses such pronouns, ask them to select a block first.
2. VALID MARKUP: Every block_content you provide MUST be valid WordPress block markup with proper <!-- wp:name {attrs} --> comments. Never output plain HTML without block comments.
3. INNER BLOCKS: When editing a block that has inner blocks, include ALL inner blocks in your replacement markup unless the user specifically asked to remove them.
4. TOOL CHAINING: When you call a read-only tool, you MUST immediately follow up by calling the appropriate mutating tool in the same interaction. Never stop after just reading data — always complete the action:
    - blu/get-block-markup → blu/edit-block (modify the returned markup and apply it)
    Do not describe what you would change or say "let's proceed" — actually call the tool and make the change.
5. MINIMAL CHANGES: Only change what the user asked for. Preserve all other content, styles, and attributes as-is.
6. MULTIPLE OPERATIONS: You can call multiple tools in one turn for complex requests (e.g., move + edit, or delete + add). Always complete the full operation — never leave an edit half-done.
7. AUTO-GENERATE CONTENT: When the user asks to rewrite, rephrase, improve, shorten, expand, or otherwise change text, generate the new text yourself based on their intent. Do not ask what the replacement text should be — use your judgment to produce appropriate content and apply it immediately.
8. POSITIONING: Use the block tree index paths and clientIds to identify blocks. The tree shows nesting — indented blocks are inner blocks.
9. TEMPLATE PARTS: Blocks inside template parts (header, footer) can be edited. Their clientIds are in the block tree.
10. ADDING SECTIONS: You can insert content after ANY block at any nesting depth — not just top-level blocks. When the user specifies a position (e.g., "add a paragraph below this heading", "add a section after the hero"), use that block's client_id as after_client_id. When the user does NOT specify a position, insert at the top level of the page (use after_client_id of the last top-level block in the tree, or null for the very top).
11. COLORS: This rule applies to EVERY block in your output — the target block AND every inner block you include. Scan the ENTIRE block_content for color violations before returning it.
    - The ONLY valid values for "backgroundColor" and "textColor" attributes are the exact theme palette slugs: base, contrast, accent-1, accent-2, accent-3, accent-4, accent-5, accent-6. No other slugs exist. If the existing markup has an invalid slug (e.g., "backgroundColor":"red"), you MUST fix it.
    - For any color that is NOT one of those theme slugs, REMOVE the "backgroundColor"/"textColor" attribute and use the style object with a HEX value instead: {"style":{"color":{"background":"#ff0000"}}} or {"style":{"color":{"text":"#ff0000"}}}.
    - This also applies inside "elements" objects (e.g., link color). Replace any named color like "green" with its HEX equivalent.
    - In the HTML portion of block markup, class names like "has-red-background-color" must be replaced with the generic "has-background" and the color applied via the inline style attribute.
    - To reference a theme preset inside the style object use "var:preset|color|<slug>" (e.g., "var:preset|color|accent-1"). In inline CSS use var(--wp--preset--color--<slug>).
    - Common color name → HEX: red → #ff0000, blue → #0000ff, green → #008000, yellow → #ffff00, orange → #ff8c00, purple → #800080, pink → #ff69b4, black → #000000, white → #ffffff.
12. NFD UTILITY CLASSES: NEVER use nfd-* utility classes in your output. When editing a block that has nfd-* classes (e.g., nfd-bg-primary, nfd-text-white, nfd-py-md, nfd-rounded, nfd-gap-sm), REMOVE any nfd-* class related to the user's requested change and apply the styling using WordPress block attributes instead. Mapping:
    - nfd-bg-* → remove class, use "backgroundColor" attribute or {"style":{"color":{"background":"#hex"}}}
    - nfd-text-{color} → remove class, use "textColor" attribute or {"style":{"color":{"text":"#hex"}}}
    - nfd-text-{size} (nfd-text-sm, nfd-text-md, nfd-text-lg, nfd-text-xl) → remove class, use {"style":{"typography":{"fontSize":"value"}}}
    - nfd-p-*, nfd-py-*, nfd-px-*, nfd-pt-*, nfd-pb-*, nfd-pl-*, nfd-pr-* → remove class, use {"style":{"spacing":{"padding":{...}}}}
    - nfd-m-*, nfd-my-*, nfd-mx-*, nfd-mt-*, nfd-mb-*, nfd-ml-*, nfd-mr-* → remove class, use {"style":{"spacing":{"margin":{...}}}}
    - nfd-gap-* → remove class, use {"style":{"spacing":{"blockGap":"value"}}}
    - nfd-rounded* → remove class, use {"style":{"border":{"radius":"value"}}}
    - nfd-grid-*, nfd-cols-*, nfd-row-*, nfd-col-*, nfd-w-*, nfd-flex-*, nfd-justify-*, nfd-items-*, nfd-self-*, nfd-order-* → remove class, use appropriate WordPress layout attributes
    Keep nfd-* classes that are unrelated to the requested change. Always prefer WordPress native block attributes over utility classes.
13. HIGHLIGHTING: When the user asks where a block is, what a block looks like, or asks you to point to something, use blu/highlight-block to select and flash the block. This scrolls it into view and adds a brief visual pulse. Do NOT use this on every tool call — only when the user is asking about location or you need to draw attention to a specific block.
14. IMAGE ASPECT RATIO: When the user asks to change an image's aspect ratio, use the "aspectRatio" and "scale" attributes — NEVER set fixed "width"/"height" in pixels. Valid aspect ratios: "1/1", "4/3", "3/4", "3/2", "2/3", "16/9", "9/16". Example markup:
    \`<!-- wp:image {"aspectRatio":"16/9","scale":"cover","sizeSlug":"full"} -->\`
    \`<figure class="wp-block-image size-full"><img src="..." alt="" style="aspect-ratio:16/9;object-fit:cover"/></figure>\`
    \`<!-- /wp:image -->\`
    The inline style on the <img> tag MUST match: \`style="aspect-ratio:{ratio};object-fit:{scale}"\`. Remove any existing "width" and "height" attributes and "is-resized" class when switching to aspect ratio.
15. COVER BLOCK OVERLAY: The cover block overlay color is controlled ONLY through block comment attributes — NEVER add inline styles to the overlay \`<span>\`. The \`<span>\` must only have classes, no \`style\` attribute.
    - For theme palette colors: use \`"overlayColor":"<slug>"\` in the block comment and add class \`has-<slug>-background-color\` to the span.
    - For custom colors: use \`"customOverlayColor":"#hex"\` in the block comment. The span gets NO inline style — WordPress handles it.
    - Overlay opacity is set via \`"dimRatio"\` (0-100) in the block comment. The span class reflects it: \`has-background-dim-{value} has-background-dim\`.
    - Example: \`<!-- wp:cover {"overlayColor":"accent-1","dimRatio":50} -->\` with \`<span aria-hidden="true" class="wp-block-cover__background has-accent-1-background-color has-background-dim-50 has-background-dim"></span>\`
    - WRONG: \`style="background-color:rgba(...)"\` on the span — this causes block validation failure.

## Response Structure
Before making changes, briefly explain your plan in 1-2 sentences:
- What you understand the user wants
- What changes you'll make

Example: "I'll modernize this About section by wrapping it in a styled group with a subtle background and improving the typography."

After changes complete, give a brief confirmation of what was done.`;

/**
 * Build editor context string with block tree and selected block markup.
 * This is prepended to user messages so the AI has current page state.
 *
 * @return {string} Editor context string wrapped in <editor_context> tags
 */
const buildEditorContext = () => {
	const { select: wpSelect } = wp.data;
	const blockEditor = wpSelect("core/block-editor");
	const blocks = getCurrentPageBlocks();
	const selectedBlocks = getSelectedBlocks();
	const selectedClientIds = selectedBlocks.map((b) => b.clientId);

	const pageTitle = getCurrentPageTitle();
	const pageId = getCurrentPageId();

	let context = `Page: "${pageTitle}" (ID: ${pageId})\n\n`;
	context += "Block tree:\n";
	context += buildCompactBlockTree(blocks, selectedClientIds, { collapseUnselected: selectedBlocks.length > 0 });

	// Layer 2: Selected block markup (one section per selected block)
	if (selectedBlocks.length > 0) {
		const { serialize: wpSerialize } = wp.blocks;
		const label = selectedBlocks.length === 1 ? "Selected block markup" : "Selected blocks markup";
		context += `\n\n${label}:`;
		for (const sel of selectedBlocks) {
			const fullBlock = blockEditor.getBlock(sel.clientId);
			if (fullBlock) {
				// Template parts serialize to a self-closing comment; show inner blocks instead.
				let markup;
				if (fullBlock.name === "core/template-part") {
					const innerBlocks = blockEditor.getBlocks(sel.clientId);
					markup = innerBlocks.map((b) => wpSerialize(b)).join("\n");
				} else {
					markup = wpSerialize(fullBlock);
				}
				context += `\n\n--- ${fullBlock.name} (id:${fullBlock.clientId}) ---\n${markup}`;
			}
		}
	}

	return context;
};

/**
 * Deep clone blocks for snapshot undo.
 * Uses the block editor's getBlocks() and serializes/re-parses for a clean deep copy.
 *
 * @param {Array} blocks Array of block objects from getBlocks()
 * @return {Array} Deep-cloned block array
 */
const snapshotBlocks = (blocks) => {
	try {
		const { serialize: wpSerialize } = wp.blocks;
		const { parse: wpParse } = wp.blocks;
		const serialized = blocks.map((b) => wpSerialize(b)).join("");
		return wpParse(serialized);
	} catch (e) {
		console.error("Failed to snapshot blocks:", e);
		return [];
	}
};

/**
 * useEditorChat Hook
 *
 * Editor-specific chat hook that uses services from wp-module-ai-chat
 * and adds editor-specific functionality like accept/decline, localStorage
 * persistence, and real-time visual updates for global styles.
 *
 * @return {Object} Chat state and handlers for the editor
 */
const useEditorChat = () => {
	// Initialize state from localStorage
	const savedSessionId = loadSessionId();
	const savedMessages = loadMessages();

	const [messages, setMessages] = useState(savedMessages || []);
	const [isLoading, setIsLoading] = useState(false);
	const [sessionId, setSessionId] = useState(savedSessionId || generateSessionId());
	const [error, setError] = useState(null);
	const [status, setStatus] = useState(null);
	const [isSaving, setIsSaving] = useState(false);
	const [hasGlobalStylesChanges, setHasGlobalStylesChanges] = useState(false);
	const [mcpConnectionStatus, setMcpConnectionStatus] = useState("disconnected");
	const [tools, setTools] = useState([]);
	const [activeToolCall, setActiveToolCall] = useState(null);
	const [toolProgress, setToolProgress] = useState(null);
	const [executedTools, setExecutedTools] = useState([]);
	const [pendingTools, setPendingTools] = useState([]);
	const [reasoningContent, setReasoningContent] = useState("");

	const hasInitializedRef = useRef(false);
	const abortControllerRef = useRef(null);
	const originalGlobalStylesRef = useRef(null);
	const blockSnapshotRef = useRef(null);

	// Get WordPress editor dispatch functions
	const { savePost } = useDispatch("core/editor");
	const { saveEditedEntityRecord } = useDispatch(coreStore);
	const { __experimentalGetCurrentGlobalStylesId } = useSelect(
		(select) => ({
			__experimentalGetCurrentGlobalStylesId:
				select(coreStore).__experimentalGetCurrentGlobalStylesId,
		}),
		[]
	);

	// Get WordPress save status
	const isSavingPost = useSelect((select) => select("core/editor").isSavingPost(), []);

	// Watch for save completion
	useEffect(() => {
		if (isSaving && !isSavingPost) {
			setMessages((prev) =>
				prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions, undoData, ...rest } = msg;
						return rest;
					}
					return msg;
				})
			);
			setHasGlobalStylesChanges(false);
			setIsSaving(false);
		}
	}, [isSaving, isSavingPost]);

	/**
	 * Initialize MCP client connection
	 */
	const initializeMCP = useCallback(async () => {
		if (mcpConnectionStatus === "connecting" || mcpConnectionStatus === "connected") {
			return;
		}

		try {
			setMcpConnectionStatus("connecting");
			await mcpClient.connect();
			await mcpClient.initialize();
			const availableTools = await mcpClient.listTools();
			setTools(availableTools);
			setMcpConnectionStatus("connected");
		} catch (err) {
			console.error("Failed to initialize MCP:", err);
			setMcpConnectionStatus("disconnected");
		}
	}, [mcpConnectionStatus]);

	// Initialize on mount
	useEffect(() => {
		if (hasInitializedRef.current) {
			return;
		}
		hasInitializedRef.current = true;

		if (!savedSessionId) {
			saveSessionId(sessionId);
		}
		initializeMCP();
	}, [sessionId, savedSessionId, initializeMCP]);

	// Save session ID when it changes
	useEffect(() => {
		saveSessionId(sessionId);
	}, [sessionId]);

	// Save messages when they change
	useEffect(() => {
		if (messages.length > 0) {
			saveMessages(messages);
		}
	}, [messages]);

	// Cleanup on unmount
	useEffect(() => {
		const controller = abortControllerRef.current;
		return () => {
			if (controller) {
				controller.abort();
			}
		};
	}, []);

	/**
	 * Helper to wait for a minimum time
	 *
	 * @param {number} ms Milliseconds to wait
	 * @return {Promise} Promise that resolves after ms
	 */
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	/**
	 * Update progress with minimum display time
	 *
	 * @param {string} message Progress message to show
	 * @param {number} minTime Minimum time to display
	 */
	const updateProgress = async (message, minTime = 400) => {
		setToolProgress(message);
		await wait(minTime);
	};

	/**
	 * Handle tool calls from OpenAI response.
	 * Supports chaining: after executing tools the follow-up model can call
	 * additional tools (e.g. get-block-markup → edit-block) up to MAX_TOOL_DEPTH.
	 *
	 * @param {Array}  toolCalls          Tool calls from OpenAI
	 * @param {string} assistantMessageId ID of the assistant message
	 * @param {Array}  previousMessages   Previous messages for context (OpenAI format)
	 * @param {string} assistantContent   Text content of the assistant turn that produced these tool calls
	 * @param {number} depth              Current recursion depth (0-based)
	 */
	const MAX_TOOL_DEPTH = 5;
	const handleToolCalls = async (toolCalls, assistantMessageId, previousMessages, assistantContent = "", depth = 0) => {
		const toolResults = [];
		const completedToolsList = [];
		let globalStylesUndoData = null;
		let hasBlockEdits = false;

		// Capture block snapshot before any tool execution for atomic undo
		const blockToolNames = [
			"blu-edit-block",
			"blu-add-section",
			"blu-delete-block",
			"blu-move-block",
		];
		const hasBlockTools = toolCalls.some(
			(tc) => blockToolNames.includes(tc.name || "")
		);
		if (hasBlockTools && !blockSnapshotRef.current) {
			const { select: wpSelect } = wp.data;
			const allBlocks = wpSelect("core/block-editor").getBlocks();
			blockSnapshotRef.current = snapshotBlocks(allBlocks);
		}

		setStatus(CHAT_STATUS.TOOL_CALL);
		await updateProgress(__("Preparing to execute actions…", "wp-module-editor-chat"), 300);

		setPendingTools(
			toolCalls.map((tc, idx) => ({
				...tc,
				id: tc.id || `tool-${idx}`,
			}))
		);
		setExecutedTools([]);

		setMessages((prev) =>
			prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, isExecutingTools: true } : msg))
		);

		for (let i = 0; i < toolCalls.length; i++) {
			const toolCall = toolCalls[i];
			const toolIndex = i + 1;
			const totalTools = toolCalls.length;

			setPendingTools((prev) => prev.filter((_, idx) => idx !== 0));
			setActiveToolCall({
				id: toolCall.id || `tool-${i}`,
				name: toolCall.name,
				arguments: toolCall.arguments,
				index: toolIndex,
				total: totalTools,
			});

			try {
				const toolName = toolCall.name || "";
				const args = toolCall.arguments || {};

				console.log({ toolCall });

				// Handle global styles update via JS service for real-time updates
				if (toolName === "blu-update-global-styles" && args.settings) {
					await updateProgress(__("Reading current styles…", "wp-module-editor-chat"), 500);

					try {
						await updateProgress(
							__("Applying style changes to your site…", "wp-module-editor-chat"),
							600
						);
						const jsResult = await updateGlobalStyles(args.settings, args.styles);

						if (jsResult.success) {
							await updateProgress(
								__("✓ Styles updated! Review and Accept or Decline.", "wp-module-editor-chat"),
								800
							);
							setHasGlobalStylesChanges(true);

							if (jsResult.undoData && !originalGlobalStylesRef.current) {
								originalGlobalStylesRef.current = jsResult.undoData;
							}
							if (originalGlobalStylesRef.current) {
								globalStylesUndoData = originalGlobalStylesRef.current;
							}

							const { undoData: _unused, ...resultForAI } = jsResult;
							toolResults.push({
								id: toolCall.id,
								result: [{ type: "text", text: JSON.stringify(resultForAI) }],
								isError: false,
								hasChanges: true,
							});
							completedToolsList.push({ ...toolCall, isError: false });
							setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
							continue;
						}
						await updateProgress(
							__("Retrying with alternative method…", "wp-module-editor-chat"),
							400
						);
					} catch (jsError) {
						console.error("JS update threw error:", jsError);
						await updateProgress(
							__("Retrying with alternative method…", "wp-module-editor-chat"),
							400
						);
					}

					// Fallback to MCP
					const result = await mcpClient.callTool(toolCall.name, toolCall.arguments);
					toolResults.push({
						id: toolCall.id,
						result: result.content,
						isError: result.isError,
					});
					completedToolsList.push({ ...toolCall, isError: result.isError });
					setExecutedTools((prev) => [...prev, { ...toolCall, isError: result.isError }]);
					continue;
				}

				// Handle get global styles via JS service
				if (toolName === "blu-get-global-styles") {
					await updateProgress(__("Reading site color palette…", "wp-module-editor-chat"), 500);

					try {
						await updateProgress(__("Analyzing theme settings…", "wp-module-editor-chat"), 600);
						const jsResult = getCurrentGlobalStyles();

						if (jsResult.palette?.length > 0 || jsResult.rawSettings) {
							const colorCount = jsResult.palette?.length || 0;
							await updateProgress(`✓ Found ${colorCount} colors in palette`, 700);
							toolResults.push({
								id: toolCall.id,
								result: [
									{
										type: "text",
										text: JSON.stringify({
											styles: jsResult,
											message: "Retrieved global styles from editor",
										}),
									},
								],
								isError: false,
							});
							completedToolsList.push({ ...toolCall, isError: false });
							setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
							continue;
						}
						await updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
					} catch (jsError) {
						console.error("JS get styles threw error:", jsError);
						await updateProgress(__("Checking WordPress database…", "wp-module-editor-chat"), 400);
					}
				}

				// Handle blu/edit-block via client-side actionExecutor
				if (toolName === "blu-edit-block" && args.client_id && args.block_content) {
		await updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

					const validation = validateBlockMarkup(args.block_content);
					if (!validation.valid) {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
						continue;
					}

					await updateProgress(__("Editing block content…", "wp-module-editor-chat"), 400);
					try {
						const editResult = await actionExecutor.handleRewriteAction(args.client_id, args.block_content);
						hasBlockEdits = true;
						await updateProgress(__("Block updated successfully", "wp-module-editor-chat"), 500);
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: true, message: editResult.message }) }],
							isError: false,
							hasChanges: true,
						});
						completedToolsList.push({ ...toolCall, isError: false });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					} catch (editError) {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: false, error: editError.message }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
					}
					continue;
				}

				// Handle blu/add-section via client-side actionExecutor
				if (toolName === "blu-add-section" && args.block_content) {
					await updateProgress(__("Validating block markup…", "wp-module-editor-chat"), 300);

					const validation = validateBlockMarkup(args.block_content);
					if (!validation.valid) {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: false, error: validation.error }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
						continue;
					}

					await updateProgress(__("Adding new section…", "wp-module-editor-chat"), 400);
					try {
						const afterClientId = args.after_client_id || null;
						const addResult = await actionExecutor.handleAddAction(afterClientId, [{ block_content: args.block_content }]);
						hasBlockEdits = true;
						await updateProgress(__("Section added successfully", "wp-module-editor-chat"), 500);
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: true, message: addResult.message, blocksAdded: addResult.blocksAdded }) }],
							isError: false,
							hasChanges: true,
						});
						completedToolsList.push({ ...toolCall, isError: false });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					} catch (addError) {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: false, error: addError.message }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
					}
					continue;
				}

				// Handle blu/delete-block via client-side actionExecutor
				if (toolName === "blu-delete-block" && args.client_id) {
		await updateProgress(__("Deleting block…", "wp-module-editor-chat"), 400);
					try {
						const deleteResult = await actionExecutor.handleDeleteAction(args.client_id);
						hasBlockEdits = true;
						await updateProgress(__("Block deleted successfully", "wp-module-editor-chat"), 500);
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: true, message: deleteResult.message }) }],
							isError: false,
							hasChanges: true,
						});
						completedToolsList.push({ ...toolCall, isError: false });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					} catch (deleteError) {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: false, error: deleteError.message }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
					}
					continue;
				}

				// Handle blu/move-block via client-side actionExecutor
				if (toolName === "blu-move-block" && args.client_id && args.target_client_id && args.position) {
					await updateProgress(__("Moving block…", "wp-module-editor-chat"), 400);
					try {
						const moveResult = await actionExecutor.handleMoveAction(args.client_id, args.target_client_id, args.position);
						hasBlockEdits = true;
						await updateProgress(__("Block moved successfully", "wp-module-editor-chat"), 500);
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: true, message: moveResult.message }) }],
							isError: false,
							hasChanges: true,
						});
						completedToolsList.push({ ...toolCall, isError: false });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					} catch (moveError) {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: false, error: moveError.message }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
					}
					continue;
				}

				// Handle blu/get-block-markup via client-side (read-only, no undo needed)
				if (toolName === "blu-get-block-markup" && args.client_id) {
					await updateProgress(__("Reading block markup…", "wp-module-editor-chat"), 300);
					const markupResult = getBlockMarkup(args.client_id);
					if (markupResult) {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify(markupResult) }],
							isError: false,
						});
						completedToolsList.push({ ...toolCall, isError: false });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					} else {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ error: `Block with clientId ${args.client_id} not found` }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
					}
					continue;
				}

				// Handle blu/highlight-block via client-side (read-only, no undo needed)
				if (toolName === "blu-highlight-block" && args.client_id) {
					await updateProgress(__("Highlighting block…", "wp-module-editor-chat"), 300);
					const { select: wpSelect, dispatch: wpDispatch } = wp.data;
					const block = wpSelect("core/block-editor").getBlock(args.client_id);
					if (block) {
						wpDispatch("core/block-editor").selectBlock(args.client_id);
						wpDispatch("core/block-editor").flashBlock(args.client_id);
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ success: true, block_name: block.name }) }],
							isError: false,
						});
						completedToolsList.push({ ...toolCall, isError: false });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: false }]);
					} else {
						toolResults.push({
							id: toolCall.id,
							result: [{ type: "text", text: JSON.stringify({ error: `Block ${args.client_id} not found` }) }],
							isError: true,
						});
						completedToolsList.push({ ...toolCall, isError: true });
						setExecutedTools((prev) => [...prev, { ...toolCall, isError: true }]);
					}
					continue;
				}

				// Default: use MCP for all other tool calls
				await updateProgress(__("Communicating with WordPress…", "wp-module-editor-chat"), 400);
				const result = await mcpClient.callTool(toolCall.name, toolCall.arguments);
				await updateProgress(__("Processing response…", "wp-module-editor-chat"), 300);
				toolResults.push({ id: toolCall.id, result: result.content, isError: result.isError });
				completedToolsList.push({ ...toolCall, isError: result.isError });
				setExecutedTools((prev) => [...prev, { ...toolCall, isError: result.isError }]);
			} catch (err) {
				console.error(`Tool call ${toolCall.name} failed:`, err);
				await updateProgress(
					__("Action failed:", "wp-module-editor-chat") + " " + err.message,
					1000
				);
				toolResults.push({ id: toolCall.id, result: null, error: err.message });
				completedToolsList.push({ ...toolCall, isError: true, errorMessage: err.message });
				setExecutedTools((prev) => [
					...prev,
					{ ...toolCall, isError: true, errorMessage: err.message },
				]);
			}
		}

		const hasChanges = toolResults.some((r) => r.hasChanges);

		// Build composite undo data from both block snapshot and global styles
		let compositeUndoData = null;
		if (hasChanges) {
			const undoParts = {};
			if (hasBlockEdits && blockSnapshotRef.current) {
				undoParts.blocks = blockSnapshotRef.current;
			}
			if (globalStylesUndoData) {
				undoParts.globalStyles = globalStylesUndoData;
			}
			if (Object.keys(undoParts).length > 0) {
				compositeUndoData = undoParts;
			}
		}

		setMessages((prev) =>
			prev.map((msg) =>
				msg.id === assistantMessageId
					? {
							...msg,
							toolResults,
							executedTools: completedToolsList,
							isExecutingTools: false,
							...(compositeUndoData
								? { hasActions: true, undoData: compositeUndoData }
								: {}),
						}
					: msg
			)
		);

		setActiveToolCall(null);
		setToolProgress(null);
		setExecutedTools([]);
		setPendingTools([]);

		// Build the full message list with proper tool call / result format
		// so the model can decide whether to call more tools or summarize.
		const assistantToolCallMessage = {
			role: "assistant",
			content: assistantContent || null,
			tool_calls: toolCalls.map((tc) => ({
				id: tc.id,
				type: "function",
				function: {
					name: tc.name,
					arguments: JSON.stringify(tc.arguments || {}),
				},
			})),
		};

		const toolResultMessages = toolResults.map((tr) => ({
			role: "tool",
			tool_call_id: tr.id,
			content: Array.isArray(tr.result)
				? tr.result.map((item) => item.text || JSON.stringify(item)).join("\n")
				: tr.error
					? JSON.stringify({ error: tr.error })
					: JSON.stringify(tr.result),
		}));

		const allMessages = [
			...previousMessages,
			assistantToolCallMessage,
			...toolResultMessages,
		];

		const hasSuccessfulResults = toolResults.some((r) => !r.error);

		if (!hasSuccessfulResults) {
			setStatus(null);
			setIsLoading(false);
			return;
		}

		// Follow up with the AI to get a response (summary or chained tool call).
		// Only pass tools after read-only calls so the model can chain (e.g. get-markup → edit).
		setStatus(CHAT_STATUS.SUMMARIZING);
		const readOnlyTools = ["blu-get-block-markup", "blu-get-global-styles", "blu-highlight-block"];
		const allToolsReadOnly = toolCalls.every((tc) => readOnlyTools.includes(tc.name || ""));
		const canChain = allToolsReadOnly && depth < MAX_TOOL_DEPTH && mcpClient.isConnected();
		const openaiTools = canChain ? mcpClient.getToolsForOpenAI() : [];
		const followUpMessageId = `assistant-followup-${Date.now()}`;
		let followUpContent = "";

		setMessages((prev) => [
			...prev,
			{
				id: followUpMessageId,
				type: "assistant",
				role: "assistant",
				content: "",
				isStreaming: true,
			},
		]);

		// Retry with backoff on 429 rate limit errors
		const MAX_RETRIES = 3;
		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			if (attempt > 0) {
				const backoff = attempt * 2000;
				await wait(backoff);
				followUpContent = "";
			}

			try {
				await openaiClient.createStreamingCompletion(
					{
						model: "gpt-4.1-mini",
						messages: allMessages,
						tools: openaiTools.length > 0 ? openaiTools : undefined,
						tool_choice: openaiTools.length > 0 ? "auto" : undefined,
						temperature: 0.2,
						max_completion_tokens: 32000,
						mode: "editor",
					},
					(chunk) => {
						if (chunk.type === "reasoning") {
							setReasoningContent((prev) => prev + chunk.content);
						}
						if (chunk.type === "content") {
							setReasoningContent(""); // Clear reasoning when content starts
							followUpContent += chunk.content;
							setMessages((prev) =>
								prev.map((msg) =>
									msg.id === followUpMessageId ? { ...msg, content: followUpContent } : msg
								)
							);
						}
					},
					async (fullMessage, toolCallsResult) => {
						setMessages((prev) =>
							prev.map((msg) =>
								msg.id === followUpMessageId
									? { ...msg, content: fullMessage, isStreaming: false, toolCalls: toolCallsResult }
									: msg
							)
						);

						if (toolCallsResult && toolCallsResult.length > 0 && canChain) {
							await handleToolCalls(toolCallsResult, followUpMessageId, allMessages, fullMessage, depth + 1);
							return;
						}

						setStatus(null);
						setIsLoading(false);
					},
					(err) => {
						// Throw so the catch block can retry on 429
						throw err;
					}
				);
				// Success — break out of retry loop
				break;
			} catch (followUpError) {
				const is429 = followUpError?.message?.includes("429") || followUpError?.status === 429;
				if (is429 && attempt < MAX_RETRIES) {
					console.warn(`[CHAIN] Rate limited (429), will retry (attempt ${attempt + 1}/${MAX_RETRIES})`);
					continue;
				}
				// Final attempt failed or non-429 error — show what we have
				console.error("Follow-up failed:", followUpError);
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === followUpMessageId
							? { ...msg, content: followUpContent || "Done.", isStreaming: false }
							: msg
					)
				);
				setStatus(null);
				setIsLoading(false);
				break;
			}
		}
	};

	/**
	 * Handle sending a message with streaming support
	 *
	 * @param {string} messageContent The message to send
	 */
	const handleSendMessage = async (messageContent) => {
		setError(null);
		setStatus(null);
		setExecutedTools([]);
		setPendingTools([]);

		// Build editor context and enrich the user's message
		const editorContext = buildEditorContext();
		const enrichedContent = `<editor_context>\n${editorContext}\n</editor_context>\n\n${messageContent}`;

		const userMessage = {
			id: `user-${Date.now()}`,
			type: "user",
			role: "user",
			content: enrichedContent,
		};
		setMessages((prev) => [...prev, { ...userMessage, content: messageContent }]);
		setIsLoading(true);
		setStatus(CHAT_STATUS.GENERATING);

		abortControllerRef.current = new AbortController();

		try {
			const recentMessages = [...messages, userMessage].slice(-6);

			// Strip tool data from older messages to save tokens — keep only last 2 tool-bearing turns
			const toolBearingIndices = recentMessages
				.map((msg, i) => (msg.toolCalls?.length > 0 || msg.toolResults?.length > 0) ? i : -1)
				.filter((i) => i !== -1);
			const keepToolDataFrom = new Set(toolBearingIndices.slice(-2));

			const openaiMessages = [
				{ role: "system", content: EDITOR_SYSTEM_PROMPT },
				...openaiClient.convertMessagesToOpenAI(
					recentMessages.map((msg, i) => ({
						role: msg.type === "user" || msg.type === "notification" ? "user" : "assistant",
						content: msg.content ?? "",
						toolCalls: keepToolDataFrom.has(i) ? msg.toolCalls : undefined,
						toolResults: keepToolDataFrom.has(i) ? msg.toolResults : undefined,
					}))
				),
			];

			const openaiTools = mcpClient.isConnected() ? mcpClient.getToolsForOpenAI() : [];
			const assistantMessageId = `assistant-${Date.now()}`;
			let currentContent = "";

			setMessages((prev) => [
				...prev,
				{
					id: assistantMessageId,
					type: "assistant",
					role: "assistant",
					content: "",
					isStreaming: true,
				},
			]);

			await openaiClient.createStreamingCompletion(
				{
					model: "gpt-4.1-mini",
					messages: openaiMessages,
					tools: openaiTools.length > 0 ? openaiTools : undefined,
					tool_choice: openaiTools.length > 0 ? "auto" : undefined,
					temperature: 0.2,
					max_completion_tokens: 32000,
					mode: "editor",
				},
				(chunk) => {
					if (chunk.type === "reasoning") {
						setReasoningContent((prev) => prev + chunk.content);
					}
					if (chunk.type === "content") {
						setReasoningContent(""); // Clear reasoning when content starts
						currentContent += chunk.content;
						setMessages((prev) =>
							prev.map((msg) =>
								msg.id === assistantMessageId ? { ...msg, content: currentContent } : msg
							)
						);
					}
				},
				async (fullMessage, toolCallsResult) => {
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? { ...msg, content: fullMessage, isStreaming: false, toolCalls: toolCallsResult }
								: msg
						)
					);

					if (toolCallsResult && toolCallsResult.length > 0 && mcpClient.isConnected()) {
						await handleToolCalls(toolCallsResult, assistantMessageId, openaiMessages, fullMessage);
						return;
					}

					setIsLoading(false);
					setStatus(null);
				},
				(err) => {
					console.error("Streaming error:", err);
					const fallbackContent =
						currentContent || __("Sorry, an error occurred.", "wp-module-editor-chat");
					setMessages((prev) =>
						prev.map((msg) =>
							msg.id === assistantMessageId
								? { ...msg, content: fallbackContent, isStreaming: false }
								: msg
						)
					);
					setError(
						__("Something went wrong. Please try again.", "wp-module-editor-chat")
					);
					setIsLoading(false);
					setStatus(null);
				}
			);
		} catch (err) {
			if (err.name === "AbortError") {
				return;
			}
			console.error("Error sending message:", err);
			setError(
				__(
					"Sorry, I encountered an error processing your request. Please try again.",
					"wp-module-editor-chat"
				)
			);
			setIsLoading(false);
			setStatus(null);
		}
	};

	/**
	 * Start a new chat session
	 */
	const handleNewChat = async () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		setIsLoading(false);
		setStatus(null);
		setError(null);
		setMessages([]);
		setHasGlobalStylesChanges(false);
		originalGlobalStylesRef.current = null;
		blockSnapshotRef.current = null;

		const newSessionId = generateSessionId();
		setSessionId(newSessionId);
		clearChatData();
		saveSessionId(newSessionId);

		if (mcpConnectionStatus !== "connected") {
			await initializeMCP();
		}
	};

	/**
	 * Accept changes - trigger WordPress save
	 */
	const handleAcceptChanges = async () => {
		setIsSaving(true);

		if (hasGlobalStylesChanges) {
			try {
				const globalStylesId = __experimentalGetCurrentGlobalStylesId
					? __experimentalGetCurrentGlobalStylesId()
					: undefined;

				if (globalStylesId) {
					await saveEditedEntityRecord("root", "globalStyles", globalStylesId);
				}
				originalGlobalStylesRef.current = null;
			} catch (saveError) {
				console.error("Error saving global styles:", saveError);
			}
		}

		// Save any dirty template-part entities
		try {
			const coreSelect = wp.data.select("core");
			const getDirtyRecords =
				coreSelect.__experimentalGetDirtyEntityRecords ||
				coreSelect.getDirtyEntityRecords;
			if (getDirtyRecords) {
				const allDirty = getDirtyRecords();
				const dirtyTemplateParts = allDirty.filter(
					(r) => r.kind === "postType" && r.name === "wp_template_part"
				);
				for (const record of dirtyTemplateParts) {
					await saveEditedEntityRecord("postType", "wp_template_part", record.key);
				}
			}
		} catch (tpError) {
			console.error("[TP-SAVE] ✗ Error saving template parts:", tpError);
		}

		// Clear block snapshot on accept — changes are now permanent
		blockSnapshotRef.current = null;

		// Notify the AI that the user accepted the changes
		setMessages((prev) => [
			...prev,
			{
				id: `notification-${Date.now()}`,
				type: "notification",
				content: "The user accepted and saved all the changes you made.",
			},
		]);

		if (savePost) {
			savePost();
		}
	};

	/**
	 * Decline changes - restore to initial state
	 */
	const handleDeclineChanges = async () => {
		const firstActionMessage = messages.find((msg) => msg.hasActions && msg.undoData);

		if (!firstActionMessage || !firstActionMessage.undoData) {
			console.error("No undo data available");
			return;
		}

		try {
			const undoData = firstActionMessage.undoData;

			if (undoData && typeof undoData === "object" && !Array.isArray(undoData)) {
				// Restore block snapshot using resetBlocks for atomic undo
				if (undoData.blocks && Array.isArray(undoData.blocks) && undoData.blocks.length > 0) {
					const { dispatch: wpDispatch } = wp.data;
					const { createBlock: wpCreateBlock } = wp.blocks;

					// Convert parsed snapshot blocks back to proper WordPress blocks
					const restoreBlock = (parsed) => {
						const innerBlocks = parsed.innerBlocks
							? parsed.innerBlocks.map((inner) => restoreBlock(inner))
							: [];
						return wpCreateBlock(parsed.name, parsed.attributes || {}, innerBlocks);
					};
					const restoredBlocks = undoData.blocks.map((b) => restoreBlock(b));
					wpDispatch("core/block-editor").resetBlocks(restoredBlocks);
				}
				if (
					undoData.globalStyles &&
					undoData.globalStyles.originalStyles &&
					undoData.globalStyles.globalStylesId
				) {
					await actionExecutor.restoreGlobalStyles(undoData.globalStyles);
				}
			} else if (Array.isArray(undoData)) {
				await actionExecutor.restoreBlocks(undoData);
			}

			setMessages((prev) => [
				...prev.map((msg) => {
					if (msg.hasActions) {
						const { hasActions, undoData: msgUndoData, ...rest } = msg;
						return rest;
					}
					return msg;
				}),
				{
					id: `notification-${Date.now()}`,
					type: "notification",
					content:
						"The user declined the changes. All modifications have been reverted to their previous state. The page is back to how it was before your last edits.",
				},
			]);

			setHasGlobalStylesChanges(false);
			originalGlobalStylesRef.current = null;
			blockSnapshotRef.current = null;
		} catch (restoreError) {
			console.error("Error restoring changes:", restoreError);
		}
	};

	/**
	 * Stop the current request
	 */
	const handleStopRequest = () => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		setMessages((prev) =>
			prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
		);

		setIsLoading(false);
		setStatus(null);
		setError(null);
	};

	return {
		messages,
		isLoading,
		sessionId,
		error,
		status,
		isSaving,
		mcpConnectionStatus,
		tools,
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		reasoningContent,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
	};
};

export { CHAT_STATUS };
export default useEditorChat;
