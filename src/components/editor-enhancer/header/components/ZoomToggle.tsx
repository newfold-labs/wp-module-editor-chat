/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { ZoomIcon } from "../icons";
import useZoomToggle from "../hooks/useZoomToggle";

export default function ZoomToggle() {
	const { active, toggle } = useZoomToggle();

	return (
		<HeaderIconButton onClick={toggle} active={active}>
			<ZoomIcon />
		</HeaderIconButton>
	);
}
