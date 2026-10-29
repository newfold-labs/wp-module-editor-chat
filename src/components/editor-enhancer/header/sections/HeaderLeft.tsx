/**
 * Internal dependencies.
 */
import {
	BlockInserter, BrandDropdownMenu,
	ChatToggle,
	DocumentOverviewToggle,
	HeaderDivider,
	HeaderSection,
	NewChatButton,
	RedoButton,
	UndoButton,
} from "../components";

export default function HeaderLeft() {
	return (
		<HeaderSection section="left">
			<BrandDropdownMenu />

			<HeaderDivider />

			{/* Chat controls: collapse toggle + new chat (chat history lands here too). */}
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
