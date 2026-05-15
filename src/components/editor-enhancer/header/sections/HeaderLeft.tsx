/**
 * Internal dependencies.
 */
import {
	BlockInserter, BluehostDropdownMenu,
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

			<BlockInserter />
			<DocumentOverviewToggle />

			<HeaderDivider />

			<UndoButton />
			<RedoButton />
		</HeaderSection>
	);
}
