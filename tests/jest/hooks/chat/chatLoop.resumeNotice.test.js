/* global beforeEach, describe, expect, jest, test */

jest.mock("../../../../src/services/toolDispatcher", () => ({
	executeToolCallsForREST: jest.fn(),
}));
jest.mock("../../../../src/services/contentNavigation", () => ({
	appendCreationLinkIfNeeded: jest.fn((message) => message),
	CREATE_ABILITIES: new Set(),
}));
jest.mock("../../../../src/services/intentClassifier", () => ({
	DEFAULT_INTENT: { task: "edit_page", content_type: null, menu_edit: null, steps: [] },
	classifyUserIntent: jest.fn(),
	getIntentNudge: jest.fn(() => "Execute the requested edit."),
	intentNeedsAllTools: jest.fn(() => false),
}));
jest.mock("../../../../src/utils/editorContext", () => ({
	ASSISTANT_JSON_FORMAT: "json",
	EXECUTE_NUDGE: "execute",
	SUMMARIZE_NUDGE: "summarize",
	PRESENT_PALETTE_OPTIONS_NUDGE: "palette",
	buildCreationSummarizeNudge: jest.fn(() => "summarize creation"),
	buildEditorContext: jest.fn(() => "current editor state"),
	buildRemainingStepsNudge: jest.fn((steps) => `remaining: ${steps.join(", ")}`),
	buildReviewPlannedStepsNudge: jest.fn((steps) => `review: ${steps.join(", ")}`),
}));
jest.mock("../../../../src/utils/editorUtils", () => ({
	restoreAnimatedBlocksInEditor: jest.fn(),
}));
jest.mock("../../../../src/utils/logger", () => ({
	__esModule: true,
	default: { log: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../../../src/hooks/chat/assistantResponse", () => ({
	MARKUP_PROVIDED_NUDGE: "markup provided",
	MAX_MARKUP_REQUESTS_PER_TURN: 2,
	canRequestBlockMarkup: jest.fn(() => false),
	filterValidMarkupClientIds: jest.fn(() => []),
	getAssistantDisplayMessage: jest.fn((content) => JSON.parse(content).message),
	parseAssistantResponse: jest.fn((content) => JSON.parse(content)),
	sanitizeUserFacingMessage: jest.fn((message) => message),
}));

const { runChatLoop } = require("../../../../src/hooks/chat/chatLoop");

const baseDeps = (streamCompletion, history, needsResumeNoticeRef) => ({
	conversationHistoryRef: { current: history },
	isFirstMessageRef: { current: false },
	pendingIntentRef: { current: null },
	needsResumeNoticeRef,
	setMessages: jest.fn(),
	setStatus: jest.fn(),
	openaiTools: [],
	streamCompletion,
	buildToolCtx: jest.fn(() => ({})),
	abortControllerRef: { current: new AbortController() },
	getSessionConfig: jest.fn(() => ({})),
	classifyUserIntent: jest.fn().mockResolvedValue({
		task: "conversational",
		content_type: null,
		menu_edit: null,
		steps: [],
	}),
});

const reply = () =>
	jest.fn().mockResolvedValue({
		content: '{"message":"ok"}',
		toolCalls: [],
		finishReason: "stop",
	});

describe("chatLoop resume note", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	test("adds the re-read note to the first request after a resume, not to the saved history", async () => {
		const streamCompletion = reply();
		const history = [{ role: "user", content: "earlier" }];
		const ref = { current: true };

		await runChatLoop("next", baseDeps(streamCompletion, history, ref));

		const sent = streamCompletion.mock.calls[0][0];
		const noteIndex = sent.findIndex(
			(m) => m.role === "system" && /re-read the current block tree/.test(m.content)
		);
		expect(noteIndex).toBeGreaterThan(-1);
		expect(sent.at(-1).role).toBe("user");
		expect(noteIndex).toBeLessThan(sent.length - 1);
		expect(history.some((m) => /re-read the current block tree/.test(m.content || ""))).toBe(false);
		expect(ref.current).toBe(false);
	});

	test("does not add the note on later turns", async () => {
		const streamCompletion = reply();

		await runChatLoop("next", baseDeps(streamCompletion, [], { current: false }));

		const sent = streamCompletion.mock.calls[0][0];
		expect(sent.some((m) => /re-read the current block tree/.test(m.content || ""))).toBe(false);
	});

	test("works when no resume ref is provided", async () => {
		const streamCompletion = reply();

		await runChatLoop("next", baseDeps(streamCompletion, [], undefined));

		expect(streamCompletion).toHaveBeenCalled();
	});
});
