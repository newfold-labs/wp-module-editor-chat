/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { MessageCirclePlusIcon } from "../icons";
import { useEditorChatActions } from "../../../../context/editorChatActions";

export default function NewChatButton() {
	const { handleNewChat, isNewChatDisabled } = useEditorChatActions();

	return (
		<HeaderIconButton
			onClick={handleNewChat}
			id="nfd-editor-chat__header__new-chat"
			label={__("New chat", "wp-module-editor-chat")}
			disabled={isNewChatDisabled}
			showTooltip
		>
			<MessageCirclePlusIcon />
		</HeaderIconButton>
	);
}
