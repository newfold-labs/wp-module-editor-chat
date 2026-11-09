/* global beforeEach, describe, expect, jest, test */

jest.mock("../../../services/toolDispatcher", () => ({
	executeToolCallsForREST: jest.fn(),
}));
jest.mock("../../../services/contentNavigation", () => ({
	appendCreationLinkIfNeeded: jest.fn((message) => message),
	CREATE_ABILITIES: new Set(),
}));
jest.mock("../../../services/intentClassifier", () => ({
	DEFAULT_INTENT: { task: "edit_page", content_type: null, menu_edit: null, steps: [] },
	classifyUserIntent: jest.fn(),
	getIntentNudge: jest.fn(() => "Execute the requested edit."),
	intentNeedsAllTools: jest.fn(() => false),
}));
jest.mock("../../../utils/editorContext", () => ({
	ASSISTANT_JSON_FORMAT: "json",
	EXECUTE_NUDGE: "execute",
	SUMMARIZE_NUDGE: "summarize",
	PRESENT_PALETTE_OPTIONS_NUDGE: "palette",
	buildCreationSummarizeNudge: jest.fn(() => "summarize creation"),
	buildEditorContext: jest.fn(() => "current editor state"),
	buildRemainingStepsNudge: jest.fn((steps) => `remaining: ${steps.join(", ")}`),
	buildReviewPlannedStepsNudge: jest.fn((steps) => `review: ${steps.join(", ")}`),
}));
jest.mock("../../../utils/editorUtils", () => ({
	restoreAnimatedBlocksInEditor: jest.fn(),
}));
jest.mock("../../../utils/logger", () => ({
	__esModule: true,
	default: { log: jest.fn(), warn: jest.fn() },
}));
jest.mock("../assistantResponse", () => ({
	MARKUP_PROVIDED_NUDGE: "markup provided",
	MAX_MARKUP_REQUESTS_PER_TURN: 2,
	canRequestBlockMarkup: jest.fn(() => false),
	filterValidMarkupClientIds: jest.fn(() => []),
	getAssistantDisplayMessage: jest.fn((content) => JSON.parse(content).message),
	parseAssistantResponse: jest.fn((content) => JSON.parse(content)),
	sanitizeUserFacingMessage: jest.fn((message) => message),
}));

const { executeToolCallsForREST } = require("../../../services/toolDispatcher");
const { runChatLoop } = require("../chatLoop");

function toolCall(id, attributes) {
	return {
		id,
		name: "blu-editor_update-block",
		arguments: { clientId: "paragraph-1", attributes },
	};
}

describe("chatLoop planned step completion", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		executeToolCallsForREST.mockResolvedValue([
			{ tool_call_id: "edit-both", content: "Applied successfully", hasChanges: true },
		]);
	});

	test("does not repeat a combined edit after one tool call completed multiple planned steps", async () => {
		const streamCompletion = jest
			.fn()
			.mockResolvedValueOnce({
				content: '{"message":"I will change the text and background."}',
				toolCalls: [
					toolCall("edit-both", {
						style: { color: { text: "#ffffff", background: "#000000" } },
					}),
				],
				finishReason: "tool_calls",
			})
			.mockResolvedValueOnce({
				content: '{"message":"Text and background updated."}',
				toolCalls: [],
				finishReason: "stop",
			})
			.mockResolvedValueOnce({
				content: '{"message":"I will update the background again."}',
				toolCalls: [
					toolCall("edit-background-again", {
						style: { color: { background: "#333333" } },
					}),
				],
				finishReason: "tool_calls",
			})
			.mockResolvedValueOnce({
				content: '{"message":"Background updated again."}',
				toolCalls: [],
				finishReason: "stop",
			});
		const classifyUserIntent = jest.fn().mockResolvedValue({
			task: "edit_page",
			content_type: null,
			menu_edit: null,
			steps: ["Change the text color", "Change the background color"],
		});
		let messages = [];
		const setMessages = (update) => {
			messages = typeof update === "function" ? update(messages) : update;
		};

		await runChatLoop("Change the text and background colors", {
			conversationHistoryRef: { current: [] },
			isFirstMessageRef: { current: false },
			pendingIntentRef: { current: null },
			setMessages,
			setStatus: jest.fn(),
			openaiTools: [{ function: { name: "blu-editor_update-block" } }],
			streamCompletion,
			buildToolCtx: jest.fn(() => ({})),
			abortControllerRef: { current: new AbortController() },
			getSessionConfig: jest.fn(() => ({})),
			classifyUserIntent,
		});

		expect(executeToolCallsForREST).toHaveBeenCalledTimes(1);
		expect(streamCompletion).toHaveBeenCalledTimes(2);
		expect(messages.at(-1).content).toBe("Text and background updated.");
	});

	test("continues when the review pass identifies a genuinely unfinished step", async () => {
		const streamCompletion = jest
			.fn()
			.mockResolvedValueOnce({
				content: '{"message":"I will change the text color."}',
				toolCalls: [
					toolCall("edit-text", {
						style: { color: { text: "#ffffff" } },
					}),
				],
				finishReason: "tool_calls",
			})
			.mockResolvedValueOnce({
				content: '{"message":"The background still needs to be changed."}',
				toolCalls: [
					toolCall("edit-background", {
						style: { color: { background: "#000000" } },
					}),
				],
				finishReason: "tool_calls",
			})
			.mockResolvedValueOnce({
				content: '{"message":"Text and background updated."}',
				toolCalls: [],
				finishReason: "stop",
			});
		const classifyUserIntent = jest.fn().mockResolvedValue({
			task: "edit_page",
			content_type: null,
			menu_edit: null,
			steps: ["Change the text color", "Change the background color"],
		});
		let messages = [];
		const setMessages = (update) => {
			messages = typeof update === "function" ? update(messages) : update;
		};

		await runChatLoop("Change the text and background colors", {
			conversationHistoryRef: { current: [] },
			isFirstMessageRef: { current: false },
			pendingIntentRef: { current: null },
			setMessages,
			setStatus: jest.fn(),
			openaiTools: [{ function: { name: "blu-editor_update-block" } }],
			streamCompletion,
			buildToolCtx: jest.fn(() => ({})),
			abortControllerRef: { current: new AbortController() },
			getSessionConfig: jest.fn(() => ({})),
			classifyUserIntent,
		});

		expect(executeToolCallsForREST).toHaveBeenCalledTimes(2);
		expect(streamCompletion).toHaveBeenCalledTimes(3);
		expect(messages.at(-1).content).toBe("Text and background updated.");
	});
});
