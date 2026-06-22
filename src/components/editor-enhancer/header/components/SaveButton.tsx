/**
 * WordPress dependencies.
 */
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";
import { useDispatch, useSelect } from "@wordpress/data";
import { store as editorStore } from "@wordpress/editor";
import { store as coreStore } from "@wordpress/core-data";

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

	const { getDirtyRecords } = useSelect((select) => {
		const { __experimentalGetDirtyEntityRecords, getDirtyEntityRecords } = select(coreStore) as any;
		return {
			getDirtyRecords: __experimentalGetDirtyEntityRecords || getDirtyEntityRecords,
		};
	});

	const { saveEditedEntityRecord } = useDispatch(coreStore);

	const isButtonDisabled =
		(isSaving || !isSaveable) && (!hasNonPostEntityChanges || isSavingNonPostEntityChanges);

	const saveDirtyTemplateParts = async () => {
		if (getDirtyRecords) {
			const dirtyTemplateParts = getDirtyRecords().filter(
				(_: any) => _.kind === "postType" && _.name === "wp_template_part"
			);
			for (const record of dirtyTemplateParts) {
				await saveEditedEntityRecord("postType", "wp_template_part", record.key);
			}
		}
	};
	const handleSave = async () => {
		if (isButtonDisabled) return;

		await saveDirtyTemplateParts();

		await savePost();
	};

	return (
		<Button
			className={classes}
			disabled={isButtonDisabled}
			onClick={handleSave}
			id="nfd-editor-chat__header__save"
		>
			<GlobeIcon className="nfd-editor-chat__header__save-button__icon" />
			<span className="nfd-editor-chat__header__save-button__label">
				{__("Publish", "wp-module-editor-chat")}
			</span>
		</Button>
	);
}
