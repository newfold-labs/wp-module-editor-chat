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

type EditorChatActions = {
	/** Clear the active chat and start fresh. */
	handleNewChat: () => void;
	/** True when there is nothing to clear (a brand-new chat). */
	isNewChatDisabled: boolean;
};

const noop = () => {};

const Context = createContext<EditorChatActions>({
	handleNewChat: noop,
	isNewChatDisabled: true,
});

export const useEditorChatActions = () => useContext(Context);

export default function EditorChatActionsProvider({
	handleNewChat,
	isNewChatDisabled,
	children,
}: EditorChatActions & { children: ReactNode }) {
	const value = useMemo(
		() => ({ handleNewChat, isNewChatDisabled }),
		[handleNewChat, isNewChatDisabled]
	);

	return <Context.Provider value={value}>{children}</Context.Provider>;
}
