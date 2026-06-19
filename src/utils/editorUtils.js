/**
 * The maximum size of the files in bytes.
 * @type {Object}
 */
const MAX_SIZE = {
	image: 10 * 1024 * 1024,    // 2 MB
	document: 5 * 1024 * 1024,  // 5 MB
};

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
	const valid = [];
	const rejected = [];

	for (const file of files) {
		if (!allowed.includes(file.type)) {
			rejected.push({ file, reason: "type" });
			continue;
		}

		const isImage = file.type.startsWith("image/");
		const maxSize = isImage ? MAX_SIZE.image : MAX_SIZE.document;

		if (file.size > maxSize) {
			rejected.push({ file, reason: "size" });
			continue;
		}

		if (valid.length >= maxNew) {
			rejected.push({ file, reason: "limit" });
			continue;
		}

		valid.push(file);
	}

	return { valid, rejected };
};
