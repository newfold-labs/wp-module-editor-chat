/** @jest-environment jsdom */ // eslint-disable-line jsdoc/check-tag-names
/* global beforeEach, describe, expect, it, jest */

jest.mock("@newfold/wp-module-ai-chat", () => ({ simpleHash: () => "site" }));

const { loadActiveChat, saveActiveChat } = require("../activeChatStorage");
const { MIGRATION_FLAG, migrateLegacyChat } = require("../legacyChatMigration");

const page = { postId: 7, postType: "page", postModifiedSeenAt: "2026-11-10 10:00:00" };
const messages = [{ id: "m1", role: "user", content: "hi" }];
const history = [{ role: "user", content: "hi" }];

describe("migrateLegacyChat", () => {
	let api;

	beforeEach(() => {
		localStorage.clear();
		api = {
			createConversation: jest.fn().mockResolvedValue({ id: 31 }),
			updateConversation: jest.fn().mockResolvedValue({ id: 31 }),
		};
	});

	it("does nothing when the migrated flag is already set", async () => {
		localStorage.setItem(MIGRATION_FLAG, "1");
		saveActiveChat(messages, history);

		const result = await migrateLegacyChat({ ...page, api });

		expect(result).toEqual({ migrated: false, conversationId: null });
		expect(api.createConversation).not.toHaveBeenCalled();
		expect(loadActiveChat().messages).toEqual(messages);
	});

	it("does nothing and leaves the flag unset when the post is not loaded yet", async () => {
		saveActiveChat(messages, history);

		const result = await migrateLegacyChat({ ...page, postId: 0, api });

		expect(result).toEqual({ migrated: false, conversationId: null });
		expect(api.createConversation).not.toHaveBeenCalled();
		expect(localStorage.getItem(MIGRATION_FLAG)).toBeNull();
		expect(loadActiveChat().messages).toEqual(messages);
	});

	it("pushes a legacy chat to the server, sets the flag and clears the cache", async () => {
		saveActiveChat(messages, history);

		const result = await migrateLegacyChat({ ...page, api });

		expect(result).toEqual({ migrated: true, conversationId: 31 });
		expect(api.createConversation).toHaveBeenCalledWith(page);
		expect(api.updateConversation).toHaveBeenCalledWith(31, {
			messages,
			history,
			postModifiedSeenAt: "2026-11-10 10:00:00",
		});
		expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
		expect(loadActiveChat().messages).toEqual([]);
	});

	it("only sets the flag when there is no legacy chat", async () => {
		const result = await migrateLegacyChat({ ...page, api });

		expect(result).toEqual({ migrated: false, conversationId: null });
		expect(api.createConversation).not.toHaveBeenCalled();
		expect(localStorage.getItem(MIGRATION_FLAG)).toBe("1");
	});

	it("leaves the flag and cache untouched and rethrows when create fails", async () => {
		api.createConversation.mockRejectedValue(new Error("boom"));
		saveActiveChat(messages, history);

		await expect(migrateLegacyChat({ ...page, api })).rejects.toThrow("boom");

		expect(localStorage.getItem(MIGRATION_FLAG)).toBeNull();
		expect(loadActiveChat().messages).toEqual(messages);
	});

	it("leaves the flag and cache untouched and rethrows when update fails", async () => {
		api.updateConversation.mockRejectedValue(new Error("nope"));
		saveActiveChat(messages, history);

		await expect(migrateLegacyChat({ ...page, api })).rejects.toThrow("nope");

		expect(localStorage.getItem(MIGRATION_FLAG)).toBeNull();
		expect(loadActiveChat().messages).toEqual(messages);
	});

	it("is a no-op the second time", async () => {
		saveActiveChat(messages, history);
		await migrateLegacyChat({ ...page, api });
		api.createConversation.mockClear();

		const second = await migrateLegacyChat({ ...page, api });

		expect(second).toEqual({ migrated: false, conversationId: null });
		expect(api.createConversation).not.toHaveBeenCalled();
	});
});
