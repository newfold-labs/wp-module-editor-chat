/**
 * WordPress dependencies.
 */
import { PostPreviewButton } from "@wordpress/editor";
import { __ } from "@wordpress/i18n";

/**
 * Internal dependencies.
 */
import { ArrowTopRightOnSquareIcon } from "../icons";

export default function PreviewButton() {
	return (
		<PostPreviewButton
			className="nfd-editor-chat__header-preview-button"
			role="menuitem"
			forceIsAutosaveable={false}
			aria-label={__("Preview", "wp-module-editor-chat")}
			// @ts-ignore textContent accepts ReactNode.
			textContent={
				<>
					{__("Preview", "wp-module-editor-chat")}
					<ArrowTopRightOnSquareIcon />
				</>
			}
		/>
	);
}
