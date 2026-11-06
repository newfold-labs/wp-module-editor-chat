/* global afterEach, beforeEach, describe, expect, jest, test */

jest.mock("@newfold/wp-module-ai-chat", () => ({
	CHAT_STATUS: { TOOL_CALL: "tool_call" },
}));
jest.mock("@wordpress/i18n", () => ({ __: (message) => message }));
jest.mock("../../utils/entityContentValidation", () => ({
	abilityUsesBlockContent: jest.fn(() => false),
	validateEntityContentArgs: jest.fn(() => ({ ok: true })),
}));
jest.mock("../callAbility", () => ({
	callAbility: jest.fn(),
	mcpResultIsError: jest.fn(() => false),
}));
jest.mock("../contentNavigation", () => ({
	CREATE_ABILITIES: new Set(),
	handleContentCreation: jest.fn(),
}));
jest.mock("../navigationEditor", () => ({
	findHeaderRefNavigationBlock: jest.fn(),
	hydrateAllRefNavigationBlocks: jest.fn(),
}));
jest.mock("../imageCache", () => ({
	appendGeneratedImageUrl: jest.fn(),
	getActiveImageEditTarget: jest.fn(),
	resetGeneratedImageCache: jest.fn(),
}));
jest.mock("../imageAbility", () => ({
	applyImageToBlock: jest.fn(),
	callImageAbility: jest.fn(),
	getBlockImageUrl: jest.fn(),
	parseImageAbilityUrl: jest.fn(),
}));
jest.mock("../localToolRegistry", () => ({
	getLocalToolFallback: jest.fn(),
	isLocalToolName: jest.fn((name) => name.startsWith("blu-editor_")),
	runLocalTool: jest.fn(),
}));
jest.mock("../../utils/editorContext", () => ({ snapshotBlocks: jest.fn(() => ["snapshot"]) }));
jest.mock("../toolHandlers/editBlock", () => ({ handleEditBlock: jest.fn() }));
jest.mock("../toolHandlers/deleteBlock", () => ({ handleDeleteBlock: jest.fn() }));
jest.mock("../toolHandlers/moveBlock", () => ({ handleMoveBlock: jest.fn() }));
jest.mock("../toolHandlers/updateBlockAttrs", () => ({ handleUpdateBlockAttrs: jest.fn() }));
jest.mock("../toolHandlers/addSection", () => ({ handleAddSection: jest.fn() }));
jest.mock("../toolHandlers/duplicate", () => ({ handleDuplicate: jest.fn() }));
jest.mock("../toolHandlers/getBlockMarkup", () => ({ handleGetBlockMarkup: jest.fn() }));
jest.mock("../toolHandlers/globalStyles", () => ({
	handleGetGlobalStyles: jest.fn(),
	handleUpdateGlobalStyles: jest.fn(),
}));
jest.mock("../toolHandlers/highlightBlock", () => ({ handleHighlightBlock: jest.fn() }));
jest.mock("../toolHandlers/insertInnerBlock", () => ({ handleInsertInnerBlock: jest.fn() }));
jest.mock("../toolHandlers/regenerateLogo", () => ({ handleRegenerateLogo: jest.fn() }));
jest.mock("../toolHandlers/editLogo", () => ({ handleEditLogo: jest.fn() }));
jest.mock("../toolHandlers/setLogoFromImage", () => ({ handleSetLogoFromImage: jest.fn() }));
jest.mock("../toolHandlers/editImage", () => ({ handleEditImage: jest.fn() }));
jest.mock("../blockToolbar/blockAI", () => ({ IMAGE_BLOCKS: new Set(["core/image"]) }));

const { snapshotBlocks } = require("../../utils/editorContext");
const { executeToolCallsForREST } = require("../toolDispatcher");
const { getLocalToolFallback, runLocalTool } = require("../localToolRegistry");
const { handleEditBlock } = require("../toolHandlers/editBlock");
const { handleAddSection } = require("../toolHandlers/addSection");
const { getActiveImageEditTarget } = require("../imageCache");
const { applyImageToBlock, callImageAbility, parseImageAbilityUrl } = require("../imageAbility");

function createContext(overrides = {}) {
	return {
		mcpClient: { callTool: jest.fn() },
		abortSignal: new AbortController().signal,
		blockSnapshotRef: { current: null },
		executedToolsRef: { current: [] },
		setExecutedTools: jest.fn(),
		setMessages: jest.fn(),
		setStatus: jest.fn(),
		setActiveToolCall: jest.fn(),
		setPendingTools: jest.fn(),
		setToolProgress: jest.fn(),
		updateProgress: jest.fn().mockResolvedValue(undefined),
		wait: jest.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function toolCall(name, argumentsValue = {}) {
	return { id: `call-${name}`, name, arguments: argumentsValue };
}

describe("toolDispatcher local abilities", () => {
	beforeEach(() => {
		global.requestAnimationFrame = (callback) => callback();
		global.wp = {
			data: {
				select: jest.fn(() => ({
					getBlocks: jest.fn(() => [{ clientId: "paragraph-1" }]),
				})),
			},
		};
		getLocalToolFallback.mockReturnValue(null);
	});

	afterEach(() => {
		jest.clearAllMocks();
		delete global.requestAnimationFrame;
		delete global.wp;
	});

	test("routes local reads through WebMCP and preserves structured output", async () => {
		const structuredContent = { count: 0, blocks: [] };
		runLocalTool.mockResolvedValue({
			isError: false,
			text: "No blocks.",
			structuredContent,
		});
		const ctx = createContext();

		const results = await executeToolCallsForREST([toolCall("blu-editor_get-editor-tree")], ctx);

		expect(runLocalTool).toHaveBeenCalledWith("blu-editor_get-editor-tree", {});
		expect(ctx.mcpClient.callTool).not.toHaveBeenCalled();
		expect(results).toEqual([
			expect.objectContaining({
				tool_call_id: "call-blu-editor_get-editor-tree",
				content: JSON.stringify(structuredContent),
				isError: false,
				hasChanges: false,
				source: "local",
				structuredContent,
			}),
		]);
		expect(snapshotBlocks).not.toHaveBeenCalled();
	});

	test("routes a hallucinated blu-editor_add-section to the server add-section handler", async () => {
		handleAddSection.mockResolvedValue({
			id: "call-add",
			result: [{ type: "text", text: JSON.stringify({ message: "Section added." }) }],
			isError: false,
			hasChanges: true,
		});
		const ctx = createContext();

		await executeToolCallsForREST(
			[
				{
					id: "call-add",
					name: "blu-editor_add-section",
					arguments: { block_content: "<!-- wp:group /-->", after_client_id: "a" },
				},
			],
			ctx
		);

		expect(runLocalTool).not.toHaveBeenCalled();
		expect(handleAddSection).toHaveBeenCalledWith(
			expect.objectContaining({ name: "blu-add-section" }),
			expect.objectContaining({ block_content: "<!-- wp:group /-->" }),
			expect.anything()
		);
	});

	test("snapshots before a local write and marks a successful mutation", async () => {
		runLocalTool.mockResolvedValue({
			isError: false,
			text: "Updated.",
			structuredContent: { changed: true, clientId: "paragraph-1" },
		});
		const ctx = createContext();

		const results = await executeToolCallsForREST(
			[toolCall("blu-editor_update-block", { clientId: "paragraph-1" })],
			ctx
		);

		expect(runLocalTool).toHaveBeenCalledWith("blu-editor_update-block", {
			clientId: "paragraph-1",
		});
		expect(snapshotBlocks).toHaveBeenCalledTimes(1);
		expect(snapshotBlocks.mock.invocationCallOrder[0]).toBeLessThan(
			runLocalTool.mock.invocationCallOrder[0]
		);
		expect(results[0]).toEqual(
			expect.objectContaining({ isError: false, hasChanges: true, source: "local" })
		);
	});

	test("aborts before local execution", async () => {
		const controller = new AbortController();
		controller.abort();
		const ctx = createContext({ abortSignal: controller.signal });

		const results = await executeToolCallsForREST(
			[toolCall("blu-editor_update-block", { clientId: "paragraph-1" })],
			ctx
		);

		expect(runLocalTool).not.toHaveBeenCalled();
		expect(snapshotBlocks).not.toHaveBeenCalled();
		expect(results[0]).toEqual(expect.objectContaining({ isError: true }));
	});

	test("an abort during the preparation wait neither snapshots nor executes", async () => {
		const controller = new AbortController();
		const ctx = createContext({
			abortSignal: controller.signal,
			wait: jest.fn().mockImplementation(async () => controller.abort()),
		});

		const results = await executeToolCallsForREST(
			[toolCall("blu-editor_update-block", { clientId: "paragraph-1" })],
			ctx
		);

		expect(runLocalTool).not.toHaveBeenCalled();
		expect(snapshotBlocks).not.toHaveBeenCalled();
		expect(results[0]).toEqual(expect.objectContaining({ isError: true }));
	});

	test("rechecks abort immediately before invoking a local tool", async () => {
		const controller = new AbortController();
		global.requestAnimationFrame = (callback) => {
			controller.abort();
			callback();
		};
		const ctx = createContext({ abortSignal: controller.signal });

		const results = await executeToolCallsForREST([toolCall("blu-editor_get-editor-tree")], ctx);

		expect(runLocalTool).not.toHaveBeenCalled();
		expect(results[0]).toEqual(expect.objectContaining({ isError: true }));
	});

	test("delegates an approved typed fallback once to its matching focused handler", async () => {
		const localError = {
			isError: true,
			text: "Special entity requires legacy handling.",
			structuredContent: {
				mutated: false,
				fallbackTool: "blu-edit-block",
				fallbackArguments: {
					client_id: "paragraph-1",
					block_content: "<!-- wp:paragraph --><p>Updated</p><!-- /wp:paragraph -->",
				},
			},
		};
		runLocalTool.mockResolvedValue(localError);
		getLocalToolFallback.mockReturnValue({
			name: "blu-edit-block",
			arguments: localError.structuredContent.fallbackArguments,
		});
		handleEditBlock.mockResolvedValue({
			result: [{ type: "text", text: JSON.stringify({ message: "Updated." }) }],
			isError: false,
			hasChanges: true,
		});
		const ctx = createContext();

		const results = await executeToolCallsForREST(
			[toolCall("blu-editor_edit-block", { clientId: "paragraph-1" })],
			ctx
		);

		expect(runLocalTool).toHaveBeenCalledTimes(1);
		expect(handleEditBlock).toHaveBeenCalledTimes(1);
		expect(ctx.mcpClient.callTool).not.toHaveBeenCalled();
		expect(results[0]).toEqual(
			expect.objectContaining({
				isError: false,
				hasChanges: true,
				source: "local-fallback",
			})
		);
	});

	test("does not fallback for an ordinary local error", async () => {
		runLocalTool.mockResolvedValue({
			isError: true,
			text: "Unknown clientId.",
			structuredContent: undefined,
		});
		const ctx = createContext();

		const results = await executeToolCallsForREST(
			[toolCall("blu-editor_update-block", { clientId: "missing" })],
			ctx
		);

		expect(getLocalToolFallback).toHaveBeenCalledTimes(1);
		expect(handleEditBlock).not.toHaveBeenCalled();
		expect(ctx.mcpClient.callTool).not.toHaveBeenCalled();
		expect(results[0]).toEqual(
			expect.objectContaining({
				content: "Unknown clientId.",
				isError: true,
				hasChanges: false,
				source: "local",
			})
		);
	});

	test("preserves partial-mutation error details and never executes again", async () => {
		const localError = {
			isError: true,
			text: 'Pattern save failed. Cleanup failed: Could not remove category "hero".',
			structuredContent: { mutated: true },
		};
		runLocalTool.mockResolvedValue(localError);
		const ctx = createContext();

		const results = await executeToolCallsForREST(
			[toolCall("blu-editor_create-pattern", { title: "Partial" })],
			ctx
		);

		expect(getLocalToolFallback).toHaveBeenCalledWith(localError);
		expect(runLocalTool).toHaveBeenCalledTimes(1);
		expect(handleEditBlock).not.toHaveBeenCalled();
		expect(ctx.mcpClient.callTool).not.toHaveBeenCalled();
		expect(results[0]).toEqual(
			expect.objectContaining({
				isError: true,
				hasChanges: true,
				source: "local",
				content: expect.stringContaining("Pattern save failed."),
				structuredContent: { mutated: true },
			})
		);
		expect(results[0].content).toContain('Cleanup failed: Could not remove category "hero".');
	});

	test("keeps the undo snapshot after a local write that failed once mutated", async () => {
		runLocalTool.mockResolvedValue({
			isError: true,
			text: "The editor did not replace this block.",
			structuredContent: { mutated: true },
		});
		const ctx = createContext();

		await executeToolCallsForREST(
			[toolCall("blu-editor_edit-block", { clientId: "paragraph-1" })],
			ctx
		);

		expect(ctx.blockSnapshotRef.current).toEqual(["snapshot"]);
		const updater = ctx.setMessages.mock.calls[ctx.setMessages.mock.calls.length - 1][0];
		const messages = updater([]);
		expect(messages[messages.length - 1].undoData).toEqual({ blocks: ["snapshot"] });
	});

	test("never re-executes a successful local write through fallback or MCP", async () => {
		runLocalTool.mockResolvedValue({
			isError: false,
			text: "Updated.",
			structuredContent: { changed: true },
		});
		const ctx = createContext();

		await executeToolCallsForREST(
			[toolCall("blu-editor_edit-block", { clientId: "paragraph-1" })],
			ctx
		);

		expect(runLocalTool).toHaveBeenCalledTimes(1);
		expect(getLocalToolFallback).not.toHaveBeenCalled();
		expect(handleEditBlock).not.toHaveBeenCalled();
		expect(ctx.mcpClient.callTool).not.toHaveBeenCalled();
	});

	test("reports a generated image as a mutation only after applying it to the active empty block", async () => {
		const imageBlock = {
			clientId: "image-empty",
			name: "core/image",
			attributes: {},
			innerBlocks: [],
		};
		global.wp.data.select.mockReturnValue({
			getBlocks: jest.fn(() => [imageBlock]),
			getBlock: jest.fn((clientId) => (clientId === imageBlock.clientId ? imageBlock : null)),
			getSelectedBlock: jest.fn(() => null),
		});
		getActiveImageEditTarget.mockReturnValue(imageBlock.clientId);
		callImageAbility.mockResolvedValue({ isError: false, content: [] });
		parseImageAbilityUrl.mockReturnValue("https://example.com/generated.jpg");
		applyImageToBlock.mockReturnValue(true);
		const ctx = createContext();

		const results = await executeToolCallsForREST(
			[toolCall("blu-generate-image", { prompt: "An office with employees" })],
			ctx
		);

		expect(applyImageToBlock).toHaveBeenCalledWith(
			imageBlock.clientId,
			"https://example.com/generated.jpg",
			"An office with employees"
		);
		expect(results[0]).toEqual(
			expect.objectContaining({
				isError: false,
				hasChanges: true,
				content: expect.stringContaining("applied"),
			})
		);
	});

	test("fails instead of claiming success when the active image block no longer exists", async () => {
		global.wp.data.select.mockReturnValue({
			getBlocks: jest.fn(() => []),
			getBlock: jest.fn(() => null),
			getSelectedBlock: jest.fn(() => null),
		});
		getActiveImageEditTarget.mockReturnValue("stale-image");
		callImageAbility.mockResolvedValue({ isError: false, content: [] });
		parseImageAbilityUrl.mockReturnValue("https://example.com/generated.jpg");
		const ctx = createContext();

		const results = await executeToolCallsForREST(
			[toolCall("blu-generate-image", { prompt: "An office with employees" })],
			ctx
		);

		expect(applyImageToBlock).not.toHaveBeenCalled();
		expect(results[0]).toEqual(
			expect.objectContaining({
				isError: true,
				hasChanges: false,
				content: expect.stringContaining("target block"),
			})
		);
	});
});
