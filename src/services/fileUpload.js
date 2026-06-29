import apiFetch from "@wordpress/api-fetch";

/**
 * Upload a file to the temporary storage.
 * @param {File} file - The file to upload.
 * @return {Promise<Object>} The response from the API.
 */
export const uploadFile = async (file) => {
	const formData = new FormData();
	formData.append("file", file);
	const response = await apiFetch({
		path: "/nfd-editor-chat/v1/upload",
		method: "POST",
		body: formData,
	});
	return response;
};

/**
 * Delete a file from the temporary storage.
 * @param {string} filename - The filename of the file to delete.
 * @return {Promise<Object>} The response from the API.
 */
export const deleteFile = async (filename) => {
	const response = await apiFetch({
		path: `/nfd-editor-chat/v1/upload/${filename}`,
		method: "DELETE",
	});
	return response;
};
