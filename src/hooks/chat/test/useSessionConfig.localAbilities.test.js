/** @jest-environment jsdom */ // eslint-disable-line jsdoc/check-tag-names
/* global afterEach, beforeEach, describe, expect, jest, test */

const mockMcpClient = {
	connect: jest.fn(),
	initialize: jest.fn(),
	listTools: jest.fn(),
};
const mockApiFetch = jest.fn();
const mockListLocalTools = jest.fn();
const mockMergeLocalAndMcpTools = jest.fn((localTools, mcpTools) => [...localTools, ...mcpTools]);
const mockOnLocalToolsChanged = jest.fn();

jest.mock("@newfold/wp-module-ai-chat", () => ({
	createMCPClient: jest.fn(() => mockMcpClient),
}));
jest.mock("@wordpress/api-fetch", () => ({
	__esModule: true,
	default: mockApiFetch,
}));
jest.mock("openai", () => ({
	__esModule: true,
	default: jest.fn(() => ({})),
}));
jest.mock("../../../services/localToolRegistry", () => ({
	listLocalTools: mockListLocalTools,
	mergeLocalAndMcpTools: mockMergeLocalAndMcpTools,
	onLocalToolsChanged: mockOnLocalToolsChanged,
}));

const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const useSessionConfig = require("../useSessionConfig").default;

const localTool = {
	name: "blu-editor_get-editor-tree",
	description: "Read the editor tree.",
	inputSchema: { type: "object", properties: {} },
};

function deferred() {
	let resolve;
	const promise = new Promise((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

async function flushAsync() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

async function renderSessionConfig() {
	const container = document.createElement("div");
	const root = createRoot(container);
	let current;

	function Harness() {
		current = useSessionConfig();
		return null;
	}

	await act(async () => {
		root.render(React.createElement(Harness));
		await flushAsync();
	});

	return {
		getCurrent: () => current,
		unmount: async () => {
			await act(async () => root.unmount());
		},
	};
}

describe("useSessionConfig local ability discovery", () => {
	let consoleError;
	let unsubscribe;
	let mounted;

	beforeEach(() => {
		global.IS_REACT_ACT_ENVIRONMENT = true;
		window.nfdEditorChat = { configEndpoint: "/editor-chat/config" };
		consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
		unsubscribe = jest.fn();
		mockOnLocalToolsChanged.mockReturnValue(unsubscribe);
		mockApiFetch.mockResolvedValue({
			session_token: "token",
			worker_url: "https://worker.example",
			expires_in: 3600,
		});
		mockMcpClient.connect.mockResolvedValue(undefined);
		mockMcpClient.initialize.mockResolvedValue(undefined);
		mockMcpClient.listTools.mockResolvedValue([]);
		mockListLocalTools.mockResolvedValue([]);
	});

	afterEach(async () => {
		if (mounted) {
			await mounted.unmount();
			mounted = null;
		}
		consoleError.mockRestore();
		jest.clearAllMocks();
		delete global.IS_REACT_ACT_ENVIRONMENT;
		delete window.nfdEditorChat;
	});

	test("publishes local tools when MCP initialization fails", async () => {
		mockMcpClient.connect.mockRejectedValue(new Error("MCP unavailable"));
		mockListLocalTools.mockResolvedValue([localTool]);

		mounted = await renderSessionConfig();

		expect(mounted.getCurrent().openaiTools).toEqual([
			{
				type: "function",
				function: {
					name: "blu-editor_get-editor-tree",
					description: "Read the editor tree.",
					parameters: { type: "object", properties: {} },
				},
			},
		]);
	});

	test("ignores a stale local-tool refresh that completes last", async () => {
		mounted = await renderSessionConfig();
		const toolChange = mockOnLocalToolsChanged.mock.calls[0][0];
		const staleRefresh = deferred();
		const latestRefresh = deferred();
		mockListLocalTools
			.mockImplementationOnce(() => staleRefresh.promise)
			.mockImplementationOnce(() => latestRefresh.promise);

		act(() => {
			toolChange();
			toolChange();
		});
		await act(async () => {
			latestRefresh.resolve([localTool]);
			await flushAsync();
		});
		expect(mounted.getCurrent().openaiTools[0].function.name).toBe("blu-editor_get-editor-tree");

		await act(async () => {
			staleRefresh.resolve([]);
			await flushAsync();
		});
		expect(mounted.getCurrent().openaiTools[0].function.name).toBe("blu-editor_get-editor-tree");
	});

	test("removes the toolchange subscription on unmount", async () => {
		mounted = await renderSessionConfig();

		await mounted.unmount();
		mounted = null;

		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
