/**
 * WordPress dependencies.
 */
import { useDispatch, useSelect } from "@wordpress/data";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * Internal dependencies.
 */
import HeaderIconButton from "./HeaderIconButton";
import { ChatIcon } from "../icons";

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
			active={isActive}
			id="nfd-editor-chat__header__chat-toggle"
		>
			<ChatIcon />
		</HeaderIconButton>
	);
}
