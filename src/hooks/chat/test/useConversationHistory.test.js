/** @jest-environment jsdom */ // eslint-disable-line jsdoc/check-tag-names
/* global afterEach, beforeEach, describe, expect, it, jest */

const mockList = jest.fn();
const mockDelete = jest.fn();

jest.mock("../../../services/conversationsApi", () => ({
	listConversations: mockList,
	deleteConversation: mockDelete,
}));

const { act, renderHook } = require("./renderHook");
const useConversationHistory = require("../useConversationHistory").default;

const item = (id) => ({ id, title: `Chat ${id}`, updated_at: "2026-11-10 10:00:00" });
const settle = async () => {
	await act(async () => {
		for (let i = 0; i < 8; i++) {
			await Promise.resolve();
		}
	});
};

describe("useConversationHistory", () => {
	let hook;

	beforeEach(() => {
		mockList.mockReset().mockResolvedValue({ items: [], next_cursor: null });
		mockDelete.mockReset().mockResolvedValue({ deleted: true });
	});

	afterEach(async () => {
		if (hook) {
			await hook.unmount();
			hook = null;
		}
	});

	it("does not load while closed", async () => {
		hook = await renderHook(useConversationHistory, { open: false });

		expect(mockList).not.toHaveBeenCalled();
	});

	it("loads the first page of 20 when opened", async () => {
		mockList.mockResolvedValue({ items: [item(3), item(2)], next_cursor: "c1" });
		hook = await renderHook(useConversationHistory, { open: false });

		await hook.rerender({ open: true });
		await settle();

		expect(mockList).toHaveBeenCalledWith({ limit: 20, cursor: null });
		expect(hook.result.current.items.map((i) => i.id)).toEqual([3, 2]);
		expect(hook.result.current.hasMore).toBe(true);
		expect(hook.result.current.isLoading).toBe(false);
	});

	it("loadMore appends the next page and stops at the end", async () => {
		mockList
			.mockResolvedValueOnce({ items: [item(3)], next_cursor: "c1" })
			.mockResolvedValueOnce({ items: [item(2)], next_cursor: null });
		hook = await renderHook(useConversationHistory, { open: true });
		await settle();

		await act(async () => hook.result.current.loadMore());
		await settle();

		expect(mockList).toHaveBeenLastCalledWith({ limit: 20, cursor: "c1" });
		expect(hook.result.current.items.map((i) => i.id)).toEqual([3, 2]);
		expect(hook.result.current.hasMore).toBe(false);
	});

	it("deleteItem removes the row immediately and keeps it removed on success", async () => {
		mockList.mockResolvedValue({ items: [item(3), item(2), item(1)], next_cursor: null });
		hook = await renderHook(useConversationHistory, { open: true });
		await settle();

		await act(async () => hook.result.current.deleteItem(2));

		expect(mockDelete).toHaveBeenCalledWith(2);
		expect(hook.result.current.items.map((i) => i.id)).toEqual([3, 1]);
	});

	it("deleteItem removes the row before the request resolves", async () => {
		let resolveDelete;
		mockDelete.mockReturnValue(
			new Promise((resolve) => {
				resolveDelete = resolve;
			})
		);
		mockList.mockResolvedValue({ items: [item(3), item(2)], next_cursor: null });
		hook = await renderHook(useConversationHistory, { open: true });
		await settle();

		let pending;
		await act(async () => {
			pending = hook.result.current.deleteItem(3);
		});
		expect(hook.result.current.items.map((i) => i.id)).toEqual([2]);

		await act(async () => {
			resolveDelete({ deleted: true });
			await pending;
		});
	});

	it("deleteItem restores the row at its original index and rejects on failure", async () => {
		mockDelete.mockRejectedValue(new Error("offline"));
		mockList.mockResolvedValue({ items: [item(3), item(2), item(1)], next_cursor: null });
		hook = await renderHook(useConversationHistory, { open: true });
		await settle();

		let caught;
		await act(async () => {
			try {
				await hook.result.current.deleteItem(2);
			} catch (err) {
				caught = err;
			}
		});

		expect(caught).toEqual(new Error("offline"));
		expect(hook.result.current.items.map((i) => i.id)).toEqual([3, 2, 1]);
	});

	it("keeps existing items and sets error when a list request fails", async () => {
		mockList.mockResolvedValueOnce({ items: [item(3)], next_cursor: "c1" });
		hook = await renderHook(useConversationHistory, { open: true });
		await settle();
		mockList.mockRejectedValueOnce(new Error("down"));

		await act(async () => hook.result.current.loadMore());
		await settle();

		expect(hook.result.current.items.map((i) => i.id)).toEqual([3]);
		expect(hook.result.current.error).toEqual(new Error("down"));
		expect(hook.result.current.isLoading).toBe(false);
	});

	it("reloads from the first page each time it is reopened", async () => {
		mockList.mockResolvedValue({ items: [item(3)], next_cursor: null });
		hook = await renderHook(useConversationHistory, { open: true });
		await settle();
		await hook.rerender({ open: false });
		mockList.mockResolvedValue({ items: [item(9), item(3)], next_cursor: null });

		await hook.rerender({ open: true });
		await settle();

		expect(hook.result.current.items.map((i) => i.id)).toEqual([9, 3]);
	});
});
