/**
 * WordPress dependencies.
 */
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { ZoomIcon } from "../icons";
import useZoomToggle from "../hooks/useZoomToggle";

export default function ZoomToggle() {
	const { active, exists, toggle } = useZoomToggle();

	if (!exists) {
		return null;
	}

	return (
		<HeaderIconButton
			onClick={toggle}
			active={active}
			id="nfd-editor-chat__header__zoom-toggle"
			label={__("Zoom Out", "wp-module-editor-chat")}
			showTooltip
		>
			<ZoomIcon />
		</HeaderIconButton>
	);
}
