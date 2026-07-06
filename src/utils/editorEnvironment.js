/**
 * Detect which WordPress editor surface loaded the chat bundle.
 *
 * @return {'site'|'post'} Editor type from PHP-localized boot data.
 */
export function getEditorType() {
	return window.nfdEditorChat?.editorType === "post" ? "post" : "site";
}

/** @return {boolean} */
export function isPostEditor() {
	return getEditorType() === "post";
}

/** @return {boolean} */
export function isSiteEditor() {
	return !isPostEditor();
}
