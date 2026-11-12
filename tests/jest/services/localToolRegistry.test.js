/* global afterEach, describe, expect, jest, test */

import {
	getLocalToolFallback,
	isLocalToolName,
	listLocalTools,
	mergeLocalAndMcpTools,
	onLocalToolsChanged,
	runLocalTool,
} from "../../../src/services/localToolRegistry";

const emptySchema = { type: "object", properties: {} };

function setModelContext(modelContext) {
	global.document = { modelContext };
}

function localTool(name, overrides = {}) {
	return {
		name,
		title: name,
		description: `${name} description`,
		inputSchema: emptySchema,
		origin: "https://example.com",
		window: {},
		...overrides,
	};
}

describe("localToolRegistry", () => {
	afterEach(() => {
		delete global.document;
	});

	test("recognizes only the exact local editor tool namespace", () => {
		expect(isLocalToolName("blu-editor_get-editor-tree")).toBe(true);
		expect(isLocalToolName("blu-get-block-markup")).toBe(false);
		expect(isLocalToolName("blu-editor/get-editor-tree")).toBe(false);
		expect(isLocalToolName("blu-editor_")).toBe(false);
		expect(isLocalToolName(null)).toBe(false);
	});

	test("lists only local editor tools and parses stringified schemas", async () => {
		setModelContext({
			getTools: jest.fn().mockResolvedValue([
				localTool("blu-editor_get-editor-tree", {
					inputSchema: JSON.stringify({
						type: "object",
						properties: { maxDepth: { type: "integer" } },
					}),
				}),
				localTool("blu-get-block-markup"),
			]),
		});

		await expect(listLocalTools()).resolves.toEqual([
			expect.objectContaining({
				name: "blu-editor_get-editor-tree",
				inputSchema: {
					type: "object",
					properties: { maxDepth: { type: "integer" } },
				},
			}),
		]);
	});

	test("listing fails soft for unavailable or malformed contexts", async () => {
		await expect(listLocalTools()).resolves.toEqual([]);

		setModelContext({ getTools: jest.fn().mockRejectedValue(new Error("disabled")) });
		await expect(listLocalTools()).resolves.toEqual([]);

		setModelContext({ getTools: jest.fn().mockResolvedValue({ tools: [] }) });
		await expect(listLocalTools()).resolves.toEqual([]);

		setModelContext({
			getTools: jest
				.fn()
				.mockResolvedValue([localTool("blu-editor_get-editor-tree", { inputSchema: "{invalid" })]),
		});
		await expect(listLocalTools()).resolves.toEqual([]);
	});

	test("executes the discovered WebMCP tool and preserves structured output", async () => {
		const tool = localTool("blu-editor_get-editor-tree");
		const structuredContent = { count: 1, blocks: [{ clientId: "paragraph-1" }] };
		const modelContext = {
			getTools: jest.fn().mockResolvedValue([tool]),
			executeTool: jest.fn().mockResolvedValue({
				content: [{ type: "text", text: "Found one block." }],
				isError: false,
				structuredContent,
			}),
		};
		setModelContext(modelContext);

		await expect(runLocalTool(tool.name, { maxDepth: 2 })).resolves.toEqual({
			isError: false,
			text: "Found one block.",
			structuredContent,
		});
		expect(modelContext.executeTool).toHaveBeenCalledWith(tool, { maxDepth: 2 });
	});

	test("execution fails soft when local WebMCP execution is unavailable", async () => {
		await expect(runLocalTool("blu-editor_get-editor-tree", {})).resolves.toEqual({
			isError: true,
			text: "Local editor tools are unavailable.",
			structuredContent: undefined,
		});

		setModelContext({
			getTools: jest.fn().mockResolvedValue([]),
			executeTool: jest.fn(),
		});
		await expect(runLocalTool("blu-editor_get-editor-tree", {})).resolves.toEqual({
			isError: true,
			text: 'Local editor tool "blu-editor_get-editor-tree" is unavailable.',
			structuredContent: undefined,
		});
	});

	test("parses the JSON string the WebMCP polyfill resolves with, keeping errors as errors", async () => {
		const tool = localTool("blu-editor_insert-block");
		setModelContext({
			getTools: jest.fn().mockResolvedValue([tool]),
			executeTool: jest.fn().mockResolvedValue(
				JSON.stringify({
					content: [{ type: "text", text: "content must be rich-text." }],
					isError: true,
				})
			),
		});
		await expect(runLocalTool(tool.name, {})).resolves.toEqual({
			isError: true,
			text: "content must be rich-text.",
			structuredContent: undefined,
		});

		const structuredContent = { changed: true, clientIds: ["a"] };
		setModelContext({
			getTools: jest.fn().mockResolvedValue([tool]),
			executeTool: jest.fn().mockResolvedValue(
				JSON.stringify({
					content: [{ type: "text", text: "{}" }],
					isError: false,
					structuredContent,
				})
			),
		});
		await expect(runLocalTool(tool.name, {})).resolves.toMatchObject({
			isError: false,
			structuredContent,
		});
	});

	test("normalizes thrown execution errors", async () => {
		const tool = localTool("blu-editor_get-editor-tree");
		setModelContext({
			getTools: jest.fn().mockResolvedValue([tool]),
			executeTool: jest.fn().mockRejectedValue(new Error("Execution failed.")),
		});

		await expect(runLocalTool(tool.name, {})).resolves.toEqual({
			isError: true,
			text: "Execution failed.",
			structuredContent: undefined,
		});
	});

	test("subscribes to tool changes and removes the same listener", () => {
		const modelContext = {
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
		};
		const callback = jest.fn();
		setModelContext(modelContext);

		const unsubscribe = onLocalToolsChanged(callback);
		expect(modelContext.addEventListener).toHaveBeenCalledWith("toolchange", callback);

		unsubscribe();
		expect(modelContext.removeEventListener).toHaveBeenCalledWith("toolchange", callback);
	});

	test("returns null when tool-change subscriptions are unsupported", () => {
		expect(onLocalToolsChanged(jest.fn())).toBeNull();
		setModelContext({});
		expect(onLocalToolsChanged(jest.fn())).toBeNull();
	});

	test("removes only direct MCP equivalents that have a local replacement", () => {
		const localTools = [
			localTool("blu-editor_edit-block"),
			localTool("blu-editor_move-block"),
			localTool("blu-editor_remove-block"),
			localTool("blu-editor_update-block"),
		];
		const gatewayTools = [
			{ name: "blu-list-abilities" },
			{ name: "blu-get-ability-schema" },
			{ name: "blu-call-ability" },
		];
		const unrelated = { name: "other-tool" };

		expect(
			mergeLocalAndMcpTools(localTools, [
				{ name: "blu-edit-block" },
				{ name: "blu-move-block" },
				{ name: "blu-delete-block" },
				{ name: "blu-update-block-attrs" },
				...gatewayTools,
				unrelated,
			])
		).toEqual([...localTools, ...gatewayTools, unrelated]);
	});

	test("never offers the local insert-block tool: sections come from the server blu-add-section", () => {
		const addSection = { name: "blu-add-section" };
		const merged = mergeLocalAndMcpTools(
			[localTool("blu-editor_insert-block"), localTool("blu-editor_get-editor-tree")],
			[addSection]
		);
		expect(merged.map((tool) => tool.name)).toEqual([
			"blu-editor_get-editor-tree",
			"blu-add-section",
		]);
	});

	test("keeps a direct MCP tool when its corresponding local tool is absent", () => {
		const directTool = { name: "blu-move-block" };
		expect(mergeLocalAndMcpTools([localTool("blu-editor_edit-block")], [directTool])).toEqual([
			expect.objectContaining({ name: "blu-editor_edit-block" }),
			directTool,
		]);
	});

	test("accepts typed fallback metadata only from an error for an allowed tool", () => {
		expect(
			getLocalToolFallback({
				isError: true,
				structuredContent: {
					mutated: false,
					fallbackTool: "blu-edit-block",
					fallbackArguments: { clientId: "paragraph-1", blockContent: "<p>New</p>" },
				},
			})
		).toEqual({
			name: "blu-edit-block",
			arguments: { clientId: "paragraph-1", blockContent: "<p>New</p>" },
		});
	});

	test("rejects ordinary errors, success actions, and unsafe fallback targets", () => {
		expect(getLocalToolFallback({ isError: true, text: "Invalid input." })).toBeNull();
		expect(
			getLocalToolFallback({
				isError: false,
				structuredContent: {
					action: "blu-edit-block",
					arguments: { clientId: "paragraph-1" },
				},
			})
		).toBeNull();
		expect(
			getLocalToolFallback({
				isError: true,
				structuredContent: {
					mutated: true,
					fallbackTool: "blu-edit-block",
					fallbackArguments: { clientId: "paragraph-1" },
				},
			})
		).toBeNull();
		expect(
			getLocalToolFallback({
				isError: true,
				structuredContent: {
					mutated: false,
					fallbackTool: "blu-call-ability",
					fallbackArguments: {},
				},
			})
		).toBeNull();
		expect(
			getLocalToolFallback({
				isError: true,
				structuredContent: {
					mutated: false,
					fallbackTool: "blu-edit-block",
					fallbackArguments: [],
				},
			})
		).toBeNull();
	});
});
