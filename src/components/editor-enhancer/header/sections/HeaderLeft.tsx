/**
 * Internal dependencies.
 */
import {
	BlockInserter, BluehostDropdownMenu,
	ChatToggle,
	DocumentOverviewToggle,
	HeaderDivider,
	HeaderSection,
	RedoButton,
	UndoButton,
} from "../components";

export default function HeaderLeft() {
	return (
		<HeaderSection section="left">
			<BluehostDropdownMenu />

			<HeaderDivider />

			<ChatToggle />
			<BlockInserter />
			<DocumentOverviewToggle />

			<HeaderDivider />

			<UndoButton />
			<RedoButton />
		</HeaderSection>
	);
}
