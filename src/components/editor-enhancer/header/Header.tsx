/**
 * WordPress dependencies.
 */
import { createPortal } from "@wordpress/element";

/**
 * Internal dependencies.
 */
import { HeaderCenter, HeaderLeft, HeaderRight } from "./sections";

const rootElement = document?.querySelector("#wpbody") as HTMLDivElement;

/**
 * Editor header
 */
export default function Header() {
	const header = (
		<div className="nfd-editor-chat__editor-header">
			<HeaderLeft />
			<HeaderCenter />
			<HeaderRight />
		</div>
	);

	return createPortal(header, rootElement);
}
