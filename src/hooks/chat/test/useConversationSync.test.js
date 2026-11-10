/** @jest-environment jsdom */ // eslint-disable-line jsdoc/check-tag-names
/* global afterEach, beforeEach, describe, expect, it, jest */

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockPageId = jest.fn();

jest.mock("../../../services/conversationsApi", () => ({
	createConversation: mockCreate,
	updateConversation: mockUpdate,
}));
jest.mock("../../../utils/editorHelpers", () => ({
	getCurrentPageId: mockPageId,
	getCurrentPageType: () => "page",
	getCurrentPageModified: () => "2026-11-10 10:00:00",
}));
jest.mock("../../../utils/logger", () => ({
	__esModule: true,
	default: { warn: jest.fn(), log: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const { act, renderHook } = require("./renderHook");
const useConversationSync = require("../useConversationSync").default;

const userMessage = { id: "u1", role: "user", content: "hello" };
const historyRef = { current: [{ role: "user", content: "hello" }] };

const advance = async (ms) => {
	await act(async () => {
		jest.advanceTimersByTime(ms);
		for (let i = 0; i < 8; i++) {
			await Promise.resolve();
		}
	});
};

const onChange = jest.fn();

const mount = (props = {}) =>
	renderHook(
		(p) =>
			useConversationSync({
				conversationHistoryRef: historyRef,
				onConversationChange: onChange,
				...p,
			}),
		{ messages: [], ...props }
	);

describe("useConversationSync", () => {
	let hook;

	beforeEach(() => {
		jest.useFakeTimers();
		onChange.mockClear();
		mockCreate.mockReset().mockResolvedValue({ id: 11 });
		mockUpdate.mockReset().mockResolvedValue({ id: 11 });
		mockPageId.mockReset().mockReturnValue(7);
	});

	afterEach(async () => {
		if (hook) {
			await hook.unmount();
			hook = null;
		}
		jest.useRealTimers();
	});

	it("does nothing on the initial mount", async () => {
		hook = await mount({ messages: [userMessage] });
		await advance(2000);

		expect(mockCreate).not.toHaveBeenCalled();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("creates the row then saves after the 1000 ms debounce", async () => {
		hook = await mount();
		await hook.rerender({ messages: [userMessage] });

		await advance(999);
		expect(mockCreate).not.toHaveBeenCalled();

		await advance(1);
		expect(mockCreate).toHaveBeenCalledWith({
			postId: 7,
			postType: "page",
			postModifiedSeenAt: "2026-11-10 10:00:00",
		});
		expect(mockUpdate).toHaveBeenCalledWith(11, {
			messages: [userMessage],
			history: historyRef.current,
			postModifiedSeenAt: "2026-11-10 10:00:00",
		});
		expect(hook.result.current.conversationId).toBe(11);
	});

	it("coalesces rapid changes into a single save", async () => {
		hook = await mount();
		await hook.rerender({ messages: [userMessage] });
		await advance(500);
		await hook.rerender({ messages: [userMessage, { id: "a1", role: "assistant", content: "x" }] });
		await advance(500);
		expect(mockUpdate).not.toHaveBeenCalled();
		await advance(500);

		expect(mockCreate).toHaveBeenCalledTimes(1);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockUpdate.mock.calls[0][1].messages).toHaveLength(2);
	});

	it("reuses an existing conversation id without creating", async () => {
		hook = await mount({ initialConversationId: 5, initialPostId: 7 });
		await hook.rerender({ messages: [userMessage] });
		await advance(1000);

		expect(mockCreate).not.toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalledWith(5, expect.any(Object));
	});

	it("does not save while read-only", async () => {
		hook = await mount({ initialConversationId: 5, initialPostId: 7 });
		await act(async () => hook.result.current.setReadOnly(true));
		await hook.rerender({ messages: [userMessage] });
		await advance(2000);

		expect(mockCreate).not.toHaveBeenCalled();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("does not save when no page is loaded yet (id 0)", async () => {
		mockPageId.mockReturnValue(0);
		hook = await mount();
		await hook.rerender({ messages: [userMessage] });
		await advance(2000);

		expect(mockCreate).not.toHaveBeenCalled();
	});

	it("does not save an empty message list", async () => {
		hook = await mount({ initialConversationId: 5, initialPostId: 7, messages: [userMessage] });
		await hook.rerender({ messages: [] });
		await advance(2000);

		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("survives a failed save and retries on the next change", async () => {
		mockUpdate.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ id: 11 });
		hook = await mount();
		await hook.rerender({ messages: [userMessage] });
		await advance(1000);
		expect(hook.result.current.conversationId).toBe(11);

		await hook.rerender({ messages: [userMessage, { id: "a1", role: "assistant", content: "x" }] });
		await advance(1000);

		expect(mockCreate).toHaveBeenCalledTimes(1);
		expect(mockUpdate).toHaveBeenCalledTimes(2);
	});

	it("drops the id on a 404 and creates a fresh row on the next message", async () => {
		mockUpdate.mockRejectedValueOnce({ code: "not_found", data: { status: 404 } });
		hook = await mount({ initialConversationId: 5, initialPostId: 7 });
		await hook.rerender({ messages: [userMessage] });
		await advance(1000);

		expect(hook.result.current.conversationId).toBeNull();
		expect(onChange).toHaveBeenCalledWith(null, null);

		await hook.rerender({ messages: [userMessage, { id: "a1", role: "assistant", content: "x" }] });
		await advance(1000);

		expect(mockCreate).toHaveBeenCalledTimes(1);
		expect(mockUpdate).toHaveBeenLastCalledWith(11, expect.any(Object));
	});

	it("omits the watermark when the current page differs from the bound page", async () => {
		hook = await mount({ initialConversationId: 5, initialPostId: 7 });
		mockPageId.mockReturnValue(99);
		await hook.rerender({ messages: [userMessage] });
		await advance(1000);

		expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty("postModifiedSeenAt");
	});

	it("setConversationId binds the id and its post", async () => {
		hook = await mount();
		await act(async () => hook.result.current.setConversationId(21, 7));

		expect(hook.result.current.conversationId).toBe(21);
		expect(hook.result.current.conversationPostIdRef.current).toBe(7);
	});

	it("suppressNextSync skips the save triggered by hydrating messages", async () => {
		hook = await mount();
		await act(async () => {
			hook.result.current.setConversationId(21, 7);
			hook.result.current.suppressNextSync();
		});
		await hook.rerender({ messages: [userMessage] });
		await advance(2000);
		expect(mockUpdate).not.toHaveBeenCalled();

		await hook.rerender({ messages: [userMessage, { id: "a1", role: "assistant", content: "x" }] });
		await advance(1000);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	it("resetSync clears the id and read-only flag and cancels a pending save", async () => {
		hook = await mount({ initialConversationId: 5, initialPostId: 7 });
		await act(async () => hook.result.current.setReadOnly(true));
		await hook.rerender({ messages: [userMessage] });
		await act(async () => hook.result.current.resetSync());
		await advance(2000);

		expect(hook.result.current.conversationId).toBeNull();
		expect(hook.result.current.readOnly).toBe(false);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("does not adopt an id created before a reset", async () => {
		let resolveCreate;
		mockCreate.mockReturnValue(
			new Promise((resolve) => {
				resolveCreate = resolve;
			})
		);
		hook = await mount();
		await hook.rerender({ messages: [userMessage] });
		await advance(1000);
		await act(async () => hook.result.current.resetSync());
		await act(async () => {
			resolveCreate({ id: 77 });
			for (let i = 0; i < 8; i++) {
				await Promise.resolve();
			}
		});

		expect(hook.result.current.conversationId).toBeNull();
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});
