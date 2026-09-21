/* global describe, expect, jest, test */

jest.mock(
	"@wordpress/abilities",
	() => ({
		executeAbility: jest.fn(),
		getAbility: jest.fn(),
	}),
	{ virtual: true }
);
jest.mock(
	"@newfold-labs/editor-chat-webmcp-env",
	() => ({
		getModelContext: jest.fn(),
	}),
	{ virtual: true }
);

import { formatToolError } from "../webmcp-bridge";

describe("WebMCP ability errors", () => {
	test("preserves an explicit fallback descriptor", () => {
		const error = new Error("Use the legacy move handler.");
		error.fallbackTool = "blu-move-block";
		error.fallbackArguments = {
			client_id: "source",
			target_client_id: "target",
			position: "after",
		};

		expect(formatToolError(error)).toEqual({
			content: [{ type: "text", text: "Use the legacy move handler." }],
			isError: true,
			structuredContent: {
				fallbackTool: "blu-move-block",
				fallbackArguments: error.fallbackArguments,
			},
		});
	});

	test("keeps ordinary errors free of fallback metadata", () => {
		expect(formatToolError(new Error("Invalid input."))).toEqual({
			content: [{ type: "text", text: "Invalid input." }],
			isError: true,
		});
	});
});
