/* global beforeEach, describe, expect, it, jest */

jest.mock("@wordpress/api-fetch", () => ({ __esModule: true, default: jest.fn() }));

const apiFetch = require("@wordpress/api-fetch").default;
const {
	createConversation,
	deleteConversation,
	getConversation,
	listConversations,
	normalizeStoredMessages,
	updateConversation,
} = require("../../../src/services/conversationsApi");

const BASE = "/nfd-editor-chat/v1/conversations";

describe("conversationsApi", () => {
	beforeEach(() => {
		apiFetch.mockReset();
		apiFetch.mockResolvedValue({});
	});

	it("createConversation POSTs snake_case page identity", async () => {
		apiFetch.mockResolvedValue({ id: 12 });

		const result = await createConversation({
			postId: 7,
			postType: "page",
			postModifiedSeenAt: "2026-11-10 10:00:00",
		});

		expect(result).toEqual({ id: 12 });
		expect(apiFetch).toHaveBeenCalledWith({
			path: BASE,
			method: "POST",
			data: { post_id: 7, post_type: "page", post_modified_seen_at: "2026-11-10 10:00:00" },
		});
	});

	it("getConversation GETs the conversation by id", async () => {
		await getConversation(5);

		expect(apiFetch).toHaveBeenCalledWith({ path: `${BASE}/5`, method: "GET" });
	});

	it("updateConversation PUTs messages, history and the watermark", async () => {
		await updateConversation(5, {
			messages: [{ id: "m1" }],
			history: [{ role: "user", content: "hi" }],
			postModifiedSeenAt: "2026-11-10 11:00:00",
		});

		expect(apiFetch).toHaveBeenCalledWith({
			path: `${BASE}/5`,
			method: "PUT",
			data: {
				messages: [{ id: "m1" }],
				history: [{ role: "user", content: "hi" }],
				post_modified_seen_at: "2026-11-10 11:00:00",
			},
		});
	});

	it("updateConversation omits the watermark when not provided", async () => {
		await updateConversation(5, { messages: [], history: [] });

		expect(apiFetch.mock.calls[0][0].data).toEqual({ messages: [], history: [] });
	});

	it("deleteConversation sends DELETE", async () => {
		await deleteConversation(5);

		expect(apiFetch).toHaveBeenCalledWith({ path: `${BASE}/5`, method: "DELETE" });
	});

	it("listConversations sends the limit and omits a null cursor", async () => {
		await listConversations({ limit: 20, cursor: null });

		expect(apiFetch).toHaveBeenCalledWith({ path: `${BASE}?limit=20`, method: "GET" });
	});

	it("listConversations includes an encoded cursor", async () => {
		await listConversations({ limit: 20, cursor: "a+b=/c" });

		expect(apiFetch).toHaveBeenCalledWith({
			path: `${BASE}?limit=20&cursor=a%2Bb%3D%2Fc`,
			method: "GET",
		});
	});

	it("listConversations defaults the limit to 20", async () => {
		await listConversations();

		expect(apiFetch.mock.calls[0][0].path).toBe(`${BASE}?limit=20`);
	});

	it("propagates API errors to the caller", async () => {
		apiFetch.mockRejectedValue({ code: "not_found", data: { status: 404 } });

		await expect(getConversation(9)).rejects.toMatchObject({ data: { status: 404 } });
	});
});

describe("normalizeStoredMessages", () => {
	it("turns an ISO timestamp string back into a Date", () => {
		const [message] = normalizeStoredMessages([
			{ id: "a", role: "user", content: "hi", timestamp: "2026-11-10T10:00:00.000Z" },
		]);

		expect(message.timestamp).toBeInstanceOf(Date);
		expect(message.timestamp.toISOString()).toBe("2026-11-10T10:00:00.000Z");
	});

	it("strips transient UI fields and keeps the rest", () => {
		const [message] = normalizeStoredMessages([
			{
				id: "a",
				content: "x",
				hasActions: true,
				undoData: { a: 1 },
				isStreaming: true,
				type: "assistant",
			},
		]);

		expect(message).toEqual({ id: "a", content: "x", type: "assistant" });
	});

	it("leaves messages without a timestamp alone", () => {
		const [message] = normalizeStoredMessages([{ id: "a", content: "x" }]);

		expect(message).toEqual({ id: "a", content: "x" });
	});

	it("returns an empty array for non-array input", () => {
		expect(normalizeStoredMessages(undefined)).toEqual([]);
		expect(normalizeStoredMessages(null)).toEqual([]);
	});
});
