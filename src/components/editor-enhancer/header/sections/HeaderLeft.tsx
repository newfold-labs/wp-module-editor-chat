/**
 * Internal dependencies.
 */
import {
	BlockInserter, BrandDropdownMenu,
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
			<BrandDropdownMenu />

			<HeaderDivider />

			{/* Chat controls: collapse toggle + chat history + new chat. */}
			<HistoryButton />
			<NewChatButton />
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
