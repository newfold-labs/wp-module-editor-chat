/**
 * WordPress dependencies.
 */
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";
import { useDispatch, useSelect } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";

/**
 * External dependencies.
 */
import classNames from "classnames";

/**
 * Internal dependencies.
 */
import { GlobeIcon } from "../icons";

export default function SaveButton() {
	const classes = classNames(["nfd-editor-chat__header-save-button"]);
	const { savePost } = useDispatch(editorStore);
	const { isSaving, isSaveable, hasNonPostEntityChanges, isSavingNonPostEntityChanges } = useSelect(
		(select) => {
			const {
				isSavingPost,
				isEditedPostSaveable,
				hasNonPostEntityChanges,
				isSavingNonPostEntityChanges,
			} = select(editorStore);
			return {
				isSaving: isSavingPost(),
				isSaveable: isEditedPostSaveable(),
				hasNonPostEntityChanges: hasNonPostEntityChanges(),
				isSavingNonPostEntityChanges: isSavingNonPostEntityChanges(),
			};
		}
	);

	const isButtonDisabled =
		(isSaving || !isSaveable) && (!hasNonPostEntityChanges || isSavingNonPostEntityChanges);

	const handleSave = () => {
		if (!isButtonDisabled) {
			savePost();
		}
	};

	return (
		<Button className={classes} disabled={isButtonDisabled} onClick={handleSave}>
			<GlobeIcon />
			{__("Publish", "wp-module-editor-chat")}
		</Button>
	);
}
