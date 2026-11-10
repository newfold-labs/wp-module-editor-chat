/** @jest-environment jsdom */ // eslint-disable-line jsdoc/check-tag-names
/* global afterEach, beforeEach, describe, expect, it, jest */

jest.mock("@wordpress/data", () => ({ select: jest.fn() }));
jest.mock("@wordpress/blocks", () => ({ serialize: jest.fn(), getBlockTypes: jest.fn(() => []) }));

const mockGet = jest.fn();
const mockDelete = jest.fn();
jest.mock("../../../services/conversationsApi", () => ({
	...jest.requireActual("../../../services/conversationsApi"),
	getConversation: mockGet,
	deleteConversation: mockDelete,
}));

const { act, renderHook } = require("./renderHook");
const useConversationResume = require("../useConversationResume").default;

const stored = (overrides = {}) => ({
	id: 5,
	post_id: 7,
	post_type: "page",
	post_exists: true,
	post_modified_seen_at: "2026-11-10 10:00:00",
	messages: {
		messages: [{ id: "u1", role: "user", content: "hi", timestamp: "2026-11-10T10:00:00.000Z" }],
		history: [{ role: "user", content: "hi" }],
	},
	...overrides,
});

describe("useConversationResume", () => {
	let hook;
	let calls;
	let deps;

	const mount = async (props = {}) => {
		hook = await renderHook(useConversationResume, { ...deps, ...props });
	};

	beforeEach(() => {
		calls = [];
		mockGet.mockReset();
		mockDelete.mockReset().mockResolvedValue({ deleted: true });
		deps = {
			getCurrentPostId: () => 7,
			getCurrentModified: () => "2026-11-10 10:00:00",
			onHydrate: jest.fn((payload) => calls.push(["hydrate", payload])),
			navigate: jest.fn(),
			onDeleted: jest.fn(),
			sync: {
				setConversationId: jest.fn((...args) => calls.push(["setId", ...args])),
				setReadOnly: jest.fn((value) => calls.push(["readOnly", value])),
				suppressNextSync: jest.fn(() => calls.push(["suppress"])),
			},
		};
	});

	afterEach(async () => {
		if (hook) {
			await hook.unmount();
			hook = null;
		}
	});

	const open = async (item = { id: 5 }) => {
		await act(async () => {
			await hook.result.current.openConversation(item);
		});
	};

	it("hydrates a conversation for the open page, editable, suppressing the echo save", async () => {
		mockGet.mockResolvedValue(stored());
		await mount();

		await open();

		expect(mockGet).toHaveBeenCalledWith(5);
		expect(calls[0]).toEqual(["suppress"]);
		const hydrate = calls.find(([kind]) => kind === "hydrate")[1];
		expect(hydrate.history).toEqual([{ role: "user", content: "hi" }]);
		expect(hydrate.messages[0].timestamp).toBeInstanceOf(Date);
		expect(deps.sync.setConversationId).toHaveBeenCalledWith(5, 7);
		expect(deps.sync.setReadOnly).toHaveBeenCalledWith(false);
		expect(hook.result.current.pageConflict).toBeNull();
		expect(hook.result.current.driftInfo).toBeNull();
		expect(hook.result.current.resumedPostMissing).toBe(false);
	});

	it("flags drift when the page was edited after the chat", async () => {
		mockGet.mockResolvedValue(stored());
		await mount({ getCurrentModified: () => "2026-11-10 12:00:00" });

		await open();

		expect(hook.result.current.driftInfo).toEqual({ seenAt: "2026-11-10 10:00:00" });
	});

	it("dismissDrift clears the banner", async () => {
		mockGet.mockResolvedValue(stored());
		await mount({ getCurrentModified: () => "2026-11-10 12:00:00" });
		await open();

		await act(async () => hook.result.current.dismissDrift());

		expect(hook.result.current.driftInfo).toBeNull();
	});

	it("asks before resuming a chat bound to a different page", async () => {
		const conversation = stored({ post_id: 99 });
		mockGet.mockResolvedValue(conversation);
		await mount();

		await open();

		expect(hook.result.current.pageConflict).toEqual({ conversation });
		expect(deps.onHydrate).not.toHaveBeenCalled();
		expect(deps.sync.setConversationId).not.toHaveBeenCalled();
	});

	it("navigates to the original page when the user chooses to", async () => {
		mockGet.mockResolvedValue(stored({ post_id: 99, post_type: "post" }));
		await mount();
		await open();

		await act(async () => hook.result.current.resolvePageConflict("navigate"));

		expect(deps.navigate).toHaveBeenCalledWith("post", 99);
		expect(deps.onHydrate).not.toHaveBeenCalled();
		expect(hook.result.current.pageConflict).toBeNull();
	});

	it("continues read-only against the current page when the user chooses to", async () => {
		mockGet.mockResolvedValue(stored({ post_id: 99 }));
		await mount();
		await open();

		await act(async () => hook.result.current.resolvePageConflict("continue"));

		expect(deps.onHydrate).toHaveBeenCalledTimes(1);
		expect(deps.sync.setReadOnly).toHaveBeenCalledWith(true);
		expect(deps.navigate).not.toHaveBeenCalled();
		expect(hook.result.current.pageConflict).toBeNull();
	});

	it("opens read-only with the missing-page flag when the original page is gone", async () => {
		mockGet.mockResolvedValue(stored({ post_exists: false }));
		await mount();

		await open();

		expect(deps.onHydrate).toHaveBeenCalledTimes(1);
		expect(deps.sync.setReadOnly).toHaveBeenCalledWith(true);
		expect(hook.result.current.resumedPostMissing).toBe(true);
	});

	it("leaves state untouched and rethrows when the conversation cannot be loaded", async () => {
		mockGet.mockRejectedValue({ data: { status: 404 } });
		await mount();

		let caught;
		await act(async () => {
			try {
				await hook.result.current.openConversation({ id: 5 });
			} catch (err) {
				caught = err;
			}
		});

		expect(caught).toEqual({ data: { status: 404 } });
		expect(deps.onHydrate).not.toHaveBeenCalled();
	});

	it("resetResume clears conflict, drift and missing-page state", async () => {
		mockGet.mockResolvedValue(stored({ post_exists: false }));
		await mount();
		await open();

		await act(async () => hook.result.current.resetResume());

		expect(hook.result.current.resumedPostMissing).toBe(false);
		expect(hook.result.current.pageConflict).toBeNull();
		expect(hook.result.current.driftInfo).toBeNull();
	});

	it("deleteConversationById deletes then calls onDeleted", async () => {
		await mount();

		await act(async () => hook.result.current.deleteConversationById(5));

		expect(mockDelete).toHaveBeenCalledWith(5);
		expect(deps.onDeleted).toHaveBeenCalledTimes(1);
	});

	it("deleteConversationById does not call onDeleted when the request fails", async () => {
		mockDelete.mockRejectedValue(new Error("offline"));
		await mount();

		let caught;
		await act(async () => {
			try {
				await hook.result.current.deleteConversationById(5);
			} catch (err) {
				caught = err;
			}
		});

		expect(caught).toEqual(new Error("offline"));
		expect(deps.onDeleted).not.toHaveBeenCalled();
	});
});
