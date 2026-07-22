/**
 * Internal dependencies.
 */
import {
	BlockInserter, BluehostDropdownMenu,
	ChatToggle,
	DocumentOverviewToggle,
	HeaderDivider,
	HeaderSection,
	HistoryButton,
	NewChatButton,
	RedoButton,
	UndoButton,
} from "../components";

export default function HeaderLeft() {
	return (
		<HeaderSection section="left">
			<BluehostDropdownMenu />

			<HeaderDivider />

			{/* Chat controls: collapse toggle + new chat + chat history. */}
			<NewChatButton />
			<HistoryButton />
			<ChatToggle />

			<HeaderDivider />

			<BlockInserter />
			<DocumentOverviewToggle />

			<HeaderDivider />

			<UndoButton />
			<RedoButton />
		</HeaderSection>
	);
}
