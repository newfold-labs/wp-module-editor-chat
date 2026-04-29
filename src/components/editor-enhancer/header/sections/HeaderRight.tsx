/**
 * Internal dependencies.
 */
import {
	ChatToggle,
	DeviceSwitcher,
	HeaderDivider,
	HeaderSection,
	PreviewButton,
	SaveButton,
	ZoomToggle,
} from "../components";

export default function HeaderRight() {
	return (
		<HeaderSection section="right">
			<DeviceSwitcher />

			<HeaderDivider />

			<ChatToggle />
			<ZoomToggle />

			<HeaderDivider />

			<PreviewButton />
			<SaveButton />
		</HeaderSection>
	);
}
