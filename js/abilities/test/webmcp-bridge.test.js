/* global afterEach, beforeEach, describe, expect, it, jest */

/**
 * External dependencies
 */
import { executeAbility, getAbility } from "@wordpress/abilities";

/**
 * Internal dependencies
 */
import { bridgeAbilitiesToWebMCP, formatToolError, toToolName } from "../webmcp-bridge";

describe("WebMCP ability bridge", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		globalThis.document = {
			modelContext: {
				registerTool: jest.fn(),
			},
		};
		getAbility.mockReturnValue({
			name: "blu-editor/get-editor-tree",
			label: "Get editor tree",
			description: "Returns the current editor block tree.",
			inputSchema: {
				type: "object",
				properties: {},
			},
			outputSchema: {
				type: "object",
				properties: {
					count: { type: "number" },
				},
			},
			annotations: {
				readonly: false,
				destructive: true,
				idempotent: true,
				untrustedContentHint: true,
				debugging: true,
			},
		});
	});

	afterEach(() => {
		delete globalThis.document;
	});

	it("converts public ability names to owned tool names", () => {
		expect(toToolName("blu-editor/get-editor-tree")).toBe("blu-editor_get-editor-tree");
	});

	it("formats ordinary errors as WebMCP error results", () => {
		expect(formatToolError(new Error("Invalid input."))).toEqual({
			content: [{ type: "text", text: "Invalid input." }],
			isError: true,
		});
	});

	it("registers each owned tool once across repeated bridge calls", async () => {
		await bridgeAbilitiesToWebMCP(["blu-editor/get-editor-tree"]);
		await bridgeAbilitiesToWebMCP(["blu-editor/get-editor-tree"]);

		expect(document.modelContext.registerTool).toHaveBeenCalledTimes(1);
		expect(document.modelContext.registerTool.mock.calls[0][0]).toMatchObject({
			name: "blu-editor_get-editor-tree",
			inputSchema: {
				type: "object",
			},
			annotations: {
				readOnlyHint: false,
				consequentialHint: true,
				untrustedContentHint: true,
				debugging: true,
			},
		});
		expect(document.modelContext.registerTool.mock.calls[0][0].annotations).not.toHaveProperty(
			"idempotentHint"
		);
	});

	it("executes through the Abilities API and preserves structured output", async () => {
		executeAbility.mockResolvedValue({ count: 0, blocks: [] });
		await bridgeAbilitiesToWebMCP(["blu-editor/get-editor-tree"]);
		const tool = document.modelContext.registerTool.mock.calls[0][0];

		await expect(tool.execute({})).resolves.toEqual({
			content: [{ type: "text", text: '{"count":0,"blocks":[]}' }],
			structuredContent: { count: 0, blocks: [] },
			isError: false,
		});
		expect(executeAbility).toHaveBeenCalledWith("blu-editor/get-editor-tree", {});
	});

	it("attaches typed fallback metadata only when an error carries it", () => {
		const error = new Error("Unsupported locally.");
		error.fallbackTool = "blu-edit-block";
		error.fallbackArguments = { clientId: "paragraph-1" };
		error.mutated = false;

		expect(formatToolError(error)).toMatchObject({
			isError: true,
			structuredContent: {
				fallbackTool: "blu-edit-block",
				fallbackArguments: { clientId: "paragraph-1" },
				mutated: false,
			},
		});
		expect(formatToolError(new Error("No fallback."))).not.toHaveProperty("structuredContent");
	});
});
