/**
 * Simple hash function to create a unique identifier from a string
 * Uses a variation of the djb2 hash algorithm
 *
 * @param {string} str - The string to hash
 * @return {string} A hexadecimal hash string
 */
export const simpleHash = (str) => {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		// eslint-disable-next-line no-bitwise
		hash = (hash << 5) + hash + str.charCodeAt(i); // hash * 33 + c
		// eslint-disable-next-line no-bitwise
		hash = hash | 0; // Convert to 32-bit integer
	}
	// Convert to unsigned and then to hex
	// eslint-disable-next-line no-bitwise
	return (hash >>> 0).toString(16);
};

