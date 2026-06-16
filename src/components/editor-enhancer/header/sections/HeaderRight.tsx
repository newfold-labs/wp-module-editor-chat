/**
 * Internal dependencies.
 */
import {
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

			<ZoomToggle />

			<HeaderDivider />

			<PreviewButton />
			<SaveButton />
		</HeaderSection>
	);
}
