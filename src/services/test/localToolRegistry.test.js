/* global afterEach, describe, expect, test */

import {
	getSupersededMcpToolNames,
	getLocalToolDelegation,
	mergeLocalAndMcpTools,
	runLocalTool,
} from "../localToolRegistry";

const tool = (name) => ({ name });

afterEach(() => {
	delete document.modelContext;
});

describe("local tool MCP deduplication", () => {
	test("keeps every MCP tool when no local equivalent is registered", () => {
		const mcpTools = [tool("blu-edit-block"), tool("blu-move-block")];

		expect(mergeLocalAndMcpTools([], mcpTools)).toEqual(mcpTools);
	});

	test("returns only MCP tools superseded by registered local equivalents", () => {
		const localTools = [
			tool("editor_move-block"),
			tool("editor_update-block"),
			tool("editor_get-editor-tree"),
		];

		expect(getSupersededMcpToolNames(localTools)).toEqual([
			"blu-move-block",
			"blu-update-block-attrs",
		]);
	});

	test("removes all four overlapping MCP tools while preserving order", () => {
		const localTools = [
			tool("editor_edit-block"),
			tool("editor_move-block"),
			tool("editor_remove-block"),
			tool("editor_update-block"),
		];
		const unrelatedMcpTool = tool("blu-add-section");

		expect(
			mergeLocalAndMcpTools(localTools, [
				tool("blu-edit-block"),
				unrelatedMcpTool,
				tool("blu-move-block"),
				tool("blu-delete-block"),
				tool("blu-update-block-attrs"),
			])
		).toEqual([...localTools, unrelatedMcpTool]);
	});

	test("does not remove MCP tools for unmapped local tools", () => {
		const localTools = [tool("editor_get-editor-tree")];
		const mcpTools = [tool("blu-get-block-markup")];

		expect(mergeLocalAndMcpTools(localTools, mcpTools)).toEqual([...localTools, ...mcpTools]);
	});

	test("restores an MCP tool after its local equivalent disappears", () => {
		const mcpTools = [tool("blu-move-block")];

		expect(mergeLocalAndMcpTools([tool("editor_move-block")], mcpTools)).toEqual([
			tool("editor_move-block"),
		]);
		expect(mergeLocalAndMcpTools([], mcpTools)).toEqual(mcpTools);
	});
});

describe("local tool delegation", () => {
	test("preserves structured content returned by WebMCP", async () => {
		const structuredContent = {
			fallbackTool: "blu-delete-block",
			fallbackArguments: { client_id: "special" },
		};
		document.modelContext = {
			getTools: async () => [tool("editor_remove-block")],
			executeTool: async () =>
				JSON.stringify({
					isError: true,
					content: [{ type: "text", text: "Use the legacy delete handler." }],
					structuredContent,
				}),
		};

		await expect(runLocalTool("editor_remove-block", { clientId: "special" })).resolves.toEqual({
			isError: true,
			text: "Use the legacy delete handler.",
			structuredContent,
		});
	});

	test.each([
		["blu-edit-block", { client_id: "edit", block_content: "<!-- wp:paragraph /-->" }],
		["blu-move-block", { client_id: "move", target_client_id: "target", position: "after" }],
		["blu-delete-block", { client_id: "remove" }],
		["blu-update-block-attrs", { client_id: "update", attributes: { align: "wide" } }],
	])("accepts a structured fallback to %s", (fallbackTool, fallbackArguments) => {
		expect(
			getLocalToolDelegation({
				isError: true,
				structuredContent: { fallbackTool, fallbackArguments },
			})
		).toEqual({
			type: "fallback",
			toolName: fallbackTool,
			arguments: fallbackArguments,
		});
	});

	test("accepts the edit-block action descriptor", () => {
		const args = { client_id: "edit", block_content: "<!-- wp:paragraph /-->" };

		expect(
			getLocalToolDelegation({
				isError: false,
				structuredContent: { action: "edit_block", arguments: args },
			})
		).toEqual({
			type: "action",
			toolName: "blu-edit-block",
			arguments: args,
		});
	});

	test("accepts the update-block action descriptor", () => {
		const args = {
			client_id: "image",
			attributes: {},
			image_prompt: "A mountain landscape",
		};

		expect(
			getLocalToolDelegation({
				isError: false,
				structuredContent: { action: "update_block_attrs", arguments: args },
			})
		).toEqual({
			type: "action",
			toolName: "blu-update-block-attrs",
			arguments: args,
		});
	});

	test("recognizes an empty local update as a no-op", () => {
		expect(
			getLocalToolDelegation({
				isError: false,
				structuredContent: {
					clientId: "image",
					name: "core/image",
					attributes: {},
					updatedAttributes: [],
				},
			})
		).toEqual({
			type: "no-op",
			toolName: "local-no-op",
			arguments: {},
		});
	});

	test.each([
		{ isError: true, structuredContent: null },
		{
			isError: true,
			structuredContent: { fallbackTool: "blu-add-section", fallbackArguments: {} },
		},
		{ isError: true, structuredContent: { fallbackTool: "blu-move-block" } },
		{ isError: false, structuredContent: { action: "unknown", arguments: {} } },
	])("rejects an invalid or ordinary local result", (result) => {
		expect(getLocalToolDelegation(result)).toBeNull();
	});
});
