/**
 * Bridges chat actions from the sidebar (ChatEditor, which owns the chat
 * state) to the editor header controls. The header is rendered with
 * createPortal, but React context still flows through portals, so a provider
 * around <EditorEnhancer /> reaches the header buttons.
 *
 * WordPress dependencies.
 */
import { createContext, useContext, useMemo } from "@wordpress/element";

/**
 * External dependencies.
 */
import type { ReactNode } from "react";

type ChatHistoryActions = {
	/** Resume a stored conversation chosen from the history list. */
	onOpen: (_item: { id: number }) => Promise<void> | void;
	/** Id of the conversation currently open, if any. */
	activeConversationId: number | null;
	/** Called after the open conversation was deleted from the list. */
	onActiveDeleted: () => void;
	/** True while a turn is running. */
	isDisabled: boolean;
};

type EditorChatActions = {
	/** Clear the active chat and start fresh. */
	handleNewChat: () => void;
	/** True when there is nothing to clear (a brand-new chat). */
	isNewChatDisabled: boolean;
	/** History list controls; omitted when history is unavailable. */
	history?: ChatHistoryActions;
};

const noop = () => {};

const Context = createContext<EditorChatActions>({
	handleNewChat: noop,
	isNewChatDisabled: true,
	history: undefined,
});

export const useEditorChatActions = () => useContext(Context);

export default function EditorChatActionsProvider({
	handleNewChat,
	isNewChatDisabled,
	history,
	children,
}: EditorChatActions & { children: ReactNode }) {
	const value = useMemo(
		() => ({ handleNewChat, isNewChatDisabled, history }),
		[handleNewChat, isNewChatDisabled, history]
	);

	return <Context.Provider value={value}>{children}</Context.Provider>;
}
