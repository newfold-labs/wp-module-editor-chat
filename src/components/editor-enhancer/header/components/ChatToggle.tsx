/**
 * WordPress dependencies.
 */
import { useDispatch, useSelect } from "@wordpress/data";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from "../icons";

const COMPLEMENTARY_AREA_SCOPE = "core";
const CHAT_IDENTIFIER = "nfd-editor-chat";

export default function ChatToggle() {
	const { enableComplementaryArea, disableComplementaryArea } = useDispatch(interfaceStore);

	const { isActive } = useSelect((select) => {
		const { getActiveComplementaryArea } = select(interfaceStore);
		const _activeArea = getActiveComplementaryArea(COMPLEMENTARY_AREA_SCOPE);

		return {
			isActive: _activeArea === CHAT_IDENTIFIER,
		};
	}, []);

	const toggle = () => {
		if (isActive) {
			disableComplementaryArea(COMPLEMENTARY_AREA_SCOPE, CHAT_IDENTIFIER);
		} else {
			enableComplementaryArea(COMPLEMENTARY_AREA_SCOPE, CHAT_IDENTIFIER);
		}
	};

	return (
		<HeaderIconButton
			onClick={toggle}
			id="nfd-editor-chat__header__chat-toggle"
			label={
				isActive
					? __("Close Chat", "wp-module-editor-chat")
					: __("Open Chat", "wp-module-editor-chat")
			}
			showTooltip
		>
			{isActive ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
		</HeaderIconButton>
	);
}
