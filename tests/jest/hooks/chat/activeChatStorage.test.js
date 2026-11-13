/** @jest-environment jsdom */ // eslint-disable-line jsdoc/check-tag-names
/* global beforeEach, describe, expect, it, jest */

jest.mock("@newfold/wp-module-ai-chat", () => ({ simpleHash: () => "site" }));

const { clearActiveChat, loadActiveChat, saveActiveChat } = require("../../../../src/hooks/chat/activeChatStorage");

const KEY = "nfd-editor-chat-active-site";

describe("activeChatStorage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("round-trips messages and history", () => {
		saveActiveChat([{ id: "m1", content: "hi" }], [{ role: "user", content: "hi" }]);

		const loaded = loadActiveChat();

		expect(loaded.messages).toEqual([{ id: "m1", content: "hi" }]);
		expect(loaded.history).toEqual([{ role: "user", content: "hi" }]);
	});

	it("round-trips the conversation id and post id", () => {
		saveActiveChat([{ id: "m1" }], [], { conversationId: 42, postId: 7 });

		expect(loadActiveChat()).toMatchObject({ conversationId: 42, postId: 7 });
	});

	it("returns null ids for entries saved without them", () => {
		saveActiveChat([{ id: "m1" }], []);

		expect(loadActiveChat()).toMatchObject({ conversationId: null, postId: null });
	});

	it("returns null ids and empty arrays when nothing is stored", () => {
		expect(loadActiveChat()).toEqual({
			messages: [],
			history: [],
			conversationId: null,
			postId: null,
		});
	});

	it("drops transient UI fields on save", () => {
		saveActiveChat([{ id: "m1", hasActions: true, undoData: { a: 1 } }], []);

		expect(loadActiveChat().messages).toEqual([{ id: "m1" }]);
	});

	it("discards an entry older than 24 hours", () => {
		localStorage.setItem(
			KEY,
			JSON.stringify({
				messages: [{ id: "old" }],
				history: [],
				conversationId: 9,
				postId: 3,
				savedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
			})
		);

		expect(loadActiveChat()).toEqual({
			messages: [],
			history: [],
			conversationId: null,
			postId: null,
		});
		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it("removes the key when saving an empty chat", () => {
		saveActiveChat([{ id: "m1" }], []);
		saveActiveChat([], []);

		expect(localStorage.getItem(KEY)).toBeNull();
	});

	it("clearActiveChat removes the key", () => {
		saveActiveChat([{ id: "m1" }], []);
		clearActiveChat();

		expect(localStorage.getItem(KEY)).toBeNull();
	});
});
