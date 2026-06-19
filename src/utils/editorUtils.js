/**
 * Basic client-side validation: keep only files whose MIME type is allowed,
 * and never accept more than `maxNew` files. Real size checks + server-side
 * validation are added with the upload service (Phase B).
 *
 * @param {File[]} files         - Files chosen by the user.
 * @param {Object} acceptedTypes - The acceptedTypes config object.
 * @param {number} maxNew        - How many more files we can still accept.
 * @return {File[]} The subset of valid files.
 */
export const validateFiles = (files, acceptedTypes, maxNew) => {
	const allowed = Object.values(acceptedTypes).flat();
	return files.filter((file) => allowed.includes(file.type)).slice(0, Math.max(0, maxNew));
};
