/**
 * WordPress dependencies.
 */
import { _x, __ } from "@wordpress/i18n";
import { __experimentalConfirmDialog as ConfirmDialog } from "@wordpress/components";

/**
 * Internal dependencies.
 */
import { usePageSelector } from "./context";

export default function PageSelectorLeavingConfirm() {
	const { navigatingToPage, handleNavigationConfirm, handleNavigationCancel } = usePageSelector();

	return (
		<ConfirmDialog
			isOpen={!!navigatingToPage}
			onConfirm={handleNavigationConfirm}
			onCancel={handleNavigationCancel}
			cancelButtonText={_x("Stay", "Dialog action: stay on page", "wp-module-editor-chat")}
			confirmButtonText={_x(
				"Leave",
				"Dialog action: leave page with unsaved changes",
				"wp-module-editor-chat"
			)}
		>
			{__(
				"You have unsaved changes. Leaving this page will discard them.",
				"wp-module-editor-chat"
			)}
		</ConfirmDialog>
	);
}
