/**
 * External dependencies.
 */
import { History } from "lucide-react";

/**
 * Internal dependencies.
 */
import ConversationHistoryDropdown from "../../../sidebar/ConversationHistoryDropdown";
import { useEditorChatActions } from "../../../../context/editorChatActions";

/**
 * Opens the list of previous chats, next to "New chat". Hidden for users who
 * cannot use the conversations API.
 * wp_localize_script delivers booleans as "1" / "", so test truthiness.
 */
export default function HistoryButton() {
	const { history } = useEditorChatActions();
	const isEditor = Boolean((window as any)?.nfdEditorChat?.isEditor);

	if (!history || !isEditor) {
		return null;
	}

	return (
		<ConversationHistoryDropdown
			disabled={history.isDisabled}
			activeConversationId={history.activeConversationId}
			onOpen={history.onOpen}
			onActiveDeleted={history.onActiveDeleted}
			toggleClassName="nfd-editor-chat__header-icon-button"
			icon={<History width="1em" height="1em" strokeWidth={1.5} />}
			showTooltip
		/>
	);
}
