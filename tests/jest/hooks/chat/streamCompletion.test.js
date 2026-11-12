/** @jest-environment jsdom */ // eslint-disable-line jsdoc/check-tag-names
/* global beforeEach, describe, expect, jest, test */

/**
 * streamCompletion tests — exercise the SDK-facing surface area:
 *   - async-iterator contract from client.chat.completions.create()
 *   - chunk shape: choices[].delta.{content, tool_calls}, usage, finish_reason
 *   - abort semantics via options.signal
 *   - max_completion_tokens (not the deprecated max_tokens)
 *
 * This is the thin seam between us and the openai SDK, so this is the file
 * that should break first if an SDK bump changes any of the above.
 */

// assistantResponse transitively pulls in @wordpress/* packages that aren't
// available in jest. streamCompletion only needs two plain string helpers from
// it, so stub the whole module.
jest.mock("../../../../src/hooks/chat/assistantResponse", () => ({
	__esModule: true,
	getAssistantDisplayMessage: (content) => content,
	sanitizeUserFacingMessage: (text) => text,
}));

// Logger reads localStorage; mock to a no-op so tests stay quiet and flag-independent.
jest.mock("../../../../src/utils/logger", () => ({
	__esModule: true,
	default: { log: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { streamCompletion } = require("../../../../src/hooks/chat/streamCompletion");

/**
 * Build an async iterable that yields each chunk in order,
 * mimicking the openai SDK's SSE stream object.
 *
 * @param {Array<object>} chunks Chunks to emit in order.
 * @return {AsyncIterable<object>} Stream mock.
 */
function makeStream(chunks) {
	return {
		[Symbol.asyncIterator]() {
			let i = 0;
			return {
				next() {
					if (i >= chunks.length) {
						return Promise.resolve({ value: undefined, done: true });
					}
					return Promise.resolve({ value: chunks[i++], done: false });
				},
			};
		},
	};
}

/**
 * Build a client mock whose chat.completions.create returns the given stream.
 *
 * @param {object}   stream       Stream to return.
 * @param {Function} [createSpy]  Optional spy to capture (body, options).
 * @return {object} Fake openai client.
 */
function makeClient(stream, createSpy) {
	return {
		chat: {
			completions: {
				create: createSpy || jest.fn(async () => stream),
			},
		},
	};
}

function makeDeps(client, signal) {
	return {
		openaiClientRef: { current: client },
		abortControllerRef: { current: signal ? { signal } : { signal: undefined } },
		setMessages: jest.fn(),
	};
}

beforeEach(() => {
	// Deterministic rAF so UI schedule+flush happens synchronously enough for assertions.
	window.requestAnimationFrame = (cb) => {
		const id = setTimeout(cb, 0);
		return id;
	};
	window.cancelAnimationFrame = (id) => clearTimeout(id);
});

describe("streamCompletion — SDK contract", () => {
	test("text-only stream resolves with concatenated content and finishReason", async () => {
		const stream = makeStream([
			{ choices: [{ delta: { content: "Hello " } }] },
			{ choices: [{ delta: { content: "world" } }] },
			{ choices: [{ delta: {}, finish_reason: "stop" }] },
			{ usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
		]);
		const client = makeClient(stream);
		const deps = makeDeps(client);

		const result = await streamCompletion([{ role: "user", content: "hi" }], [], { silent: true }, deps);

		expect(result.content).toBe("Hello world");
		expect(result.finishReason).toBe("stop");
		expect(result.toolCalls).toBeNull();
	});

	test("passes max_completion_tokens (not the deprecated max_tokens) in the request body", async () => {
		const createSpy = jest.fn(async () => makeStream([]));
		const client = makeClient(null, createSpy);
		const deps = makeDeps(client);

		await streamCompletion([{ role: "user", content: "hi" }], [], { silent: true }, deps);

		const [body] = createSpy.mock.calls[0];
		expect(body).toHaveProperty("max_completion_tokens");
		expect(body).not.toHaveProperty("max_tokens");
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
	});

	test("passes tools and tool_choice: 'auto' when tools are provided", async () => {
		const createSpy = jest.fn(async () => makeStream([]));
		const client = makeClient(null, createSpy);
		const deps = makeDeps(client);
		const tools = [{ type: "function", function: { name: "do_thing", parameters: {} } }];

		await streamCompletion([{ role: "user", content: "hi" }], tools, { silent: true }, deps);

		const [body] = createSpy.mock.calls[0];
		expect(body.tools).toBe(tools);
		expect(body.tool_choice).toBe("auto");
	});

	test("omits tools and tool_choice when tools array is empty", async () => {
		const createSpy = jest.fn(async () => makeStream([]));
		const client = makeClient(null, createSpy);
		const deps = makeDeps(client);

		await streamCompletion([{ role: "user", content: "hi" }], [], { silent: true }, deps);

		const [body] = createSpy.mock.calls[0];
		expect(body.tools).toBeUndefined();
		expect(body.tool_choice).toBeUndefined();
	});

	test("reassembles a fragmented tool call across chunks", async () => {
		const stream = makeStream([
			{
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, id: "call_1", function: { name: "edit_block" } }],
						},
					},
				],
			},
			{
				choices: [
					{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"clientId":' } }] } },
				],
			},
			{
				choices: [
					{ delta: { tool_calls: [{ index: 0, function: { arguments: '"abc"}' } }] } },
				],
			},
			{ choices: [{ delta: {}, finish_reason: "tool_calls" }] },
		]);
		const deps = makeDeps(makeClient(stream));

		const result = await streamCompletion([{ role: "user", content: "hi" }], [], { silent: true }, deps);

		expect(result.finishReason).toBe("tool_calls");
		expect(result.toolCalls).toEqual([
			{ id: "call_1", name: "edit_block", arguments: { clientId: "abc" }, _truncated: false },
		]);
	});

	test("marks tool call as truncated when arguments JSON is unrecoverable", async () => {
		const stream = makeStream([
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_2",
									function: { name: "edit_block", arguments: '{"clientId":"ab' },
								},
							],
						},
					},
				],
			},
			{ choices: [{ delta: {}, finish_reason: "length" }] },
		]);
		const deps = makeDeps(makeClient(stream));

		const result = await streamCompletion([{ role: "user" }], [], { silent: true }, deps);

		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].id).toBe("call_2");
		expect(result.toolCalls[0].name).toBe("edit_block");
		expect(result.toolCalls[0]._truncated).toBe(true);
	});

	test("throws AbortError when the signal is already aborted at entry", async () => {
		const controller = new AbortController();
		controller.abort();
		const client = makeClient(makeStream([]));
		const deps = makeDeps(client, controller.signal);

		await expect(
			streamCompletion([{ role: "user" }], [], { silent: true }, deps)
		).rejects.toMatchObject({ name: "AbortError" });
	});

	test("throws AbortError when the signal aborts mid-stream", async () => {
		const controller = new AbortController();
		const stream = {
			[Symbol.asyncIterator]() {
				let i = 0;
				const chunks = [
					{ choices: [{ delta: { content: "pa" } }] },
					{ choices: [{ delta: { content: "rt" } }] },
				];
				return {
					next() {
						// Abort after yielding the first chunk — the second
						// pulls through before the loop re-checks the signal.
						if (i === 1) {
							controller.abort();
						}
						if (i >= chunks.length) {
							return Promise.resolve({ value: undefined, done: true });
						}
						return Promise.resolve({ value: chunks[i++], done: false });
					},
				};
			},
		};
		const deps = makeDeps(makeClient(stream), controller.signal);

		await expect(
			streamCompletion([{ role: "user" }], [], { silent: true }, deps)
		).rejects.toMatchObject({ name: "AbortError" });
	});

	test("throws when the client is not initialized", async () => {
		const deps = makeDeps(null);
		deps.openaiClientRef = { current: null };

		await expect(streamCompletion([], [], {}, deps)).rejects.toThrow("OpenAI client not initialized");
	});

	test("prefers options.model over window.nfdEditorChat.model", async () => {
		window.nfdEditorChat = { model: "window-model" };
		const createSpy = jest.fn(async () => makeStream([]));
		const deps = makeDeps(makeClient(null, createSpy));

		await streamCompletion([], [], { silent: true, model: "explicit-model" }, deps);

		expect(createSpy.mock.calls[0][0].model).toBe("explicit-model");
		delete window.nfdEditorChat;
	});
});
