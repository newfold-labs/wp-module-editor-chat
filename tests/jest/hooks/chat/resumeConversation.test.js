/* global describe, expect, it, jest */

jest.mock("@wordpress/data", () => ({ select: jest.fn() }));
jest.mock("@wordpress/blocks", () => ({ serialize: jest.fn(), getBlockTypes: jest.fn(() => []) }));

const { getDriftInfo, hydrateConversation, resolveResumeMode } = require("../../../../src/hooks/chat/resumeConversation");

describe("resolveResumeMode", () => {
	it("is readonly-missing when the post no longer exists", () => {
		const conversation = { post_id: 7, post_exists: false, post_status: null };

		expect(resolveResumeMode({ conversation, currentPostId: 7 })).toBe("readonly-missing");
	});

	it("is readonly-missing when the post is trashed", () => {
		const conversation = { post_id: 7, post_exists: false, post_status: "trash" };

		expect(resolveResumeMode({ conversation, currentPostId: 7 })).toBe("readonly-missing");
	});

	it("prefers readonly-missing over conflict when the other page is gone", () => {
		const conversation = { post_id: 7, post_exists: false };

		expect(resolveResumeMode({ conversation, currentPostId: 99 })).toBe("readonly-missing");
	});

	it("is conflict when the chat belongs to a different, existing page", () => {
		const conversation = { post_id: 7, post_exists: true };

		expect(resolveResumeMode({ conversation, currentPostId: 99 })).toBe("conflict");
	});

	it("is hydrate when the chat belongs to the open page", () => {
		const conversation = { post_id: 7, post_exists: true };

		expect(resolveResumeMode({ conversation, currentPostId: 7 })).toBe("hydrate");
	});
});

describe("getDriftInfo", () => {
	const conversation = { post_modified_seen_at: "2026-11-10 10:00:00" };

	it("returns the seen-at when the page was edited since", () => {
		expect(getDriftInfo({ conversation, currentModified: "2026-11-10 11:00:00" })).toEqual({
			seenAt: "2026-11-10 10:00:00",
		});
	});

	it("is null when the page is unchanged", () => {
		expect(getDriftInfo({ conversation, currentModified: "2026-11-10 10:00:00" })).toBeNull();
	});

	it("is null when the current page is older than the watermark", () => {
		expect(getDriftInfo({ conversation, currentModified: "2026-11-09 10:00:00" })).toBeNull();
	});

	it("is null when the current timestamp is unavailable", () => {
		expect(getDriftInfo({ conversation, currentModified: "" })).toBeNull();
	});
});

describe("hydrateConversation", () => {
	it("restores timestamps and strips transient fields from messages", () => {
		const conversation = {
			messages: {
				messages: [
					{ id: "a", content: "hi", timestamp: "2026-11-10T10:00:00.000Z", hasActions: true },
				],
				history: [{ role: "user", content: "hi" }],
			},
		};

		const { messages, history } = hydrateConversation(conversation);

		expect(messages).toHaveLength(1);
		expect(messages[0].timestamp).toBeInstanceOf(Date);
		expect(messages[0]).not.toHaveProperty("hasActions");
		expect(history).toEqual([{ role: "user", content: "hi" }]);
	});

	it("defaults to empty arrays when keys are missing", () => {
		expect(hydrateConversation({ messages: {} })).toEqual({ messages: [], history: [] });
		expect(hydrateConversation({ messages: null })).toEqual({ messages: [], history: [] });
		expect(hydrateConversation({})).toEqual({ messages: [], history: [] });
	});
});
