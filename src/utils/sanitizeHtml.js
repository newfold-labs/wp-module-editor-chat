/**
 * External dependencies
 */
import DOMPurify from "dompurify";

/**
 * Sanitize HTML content using DOMPurify to prevent XSS attacks
 *
 * @param {string} html - The HTML string to sanitize.
 * @return {string} The sanitized HTML string.
 */
export const sanitizeHtml = (html) => {
	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS: [
			"section",
			"div",
			"h1",
			"h2",
			"h3",
			"h4",
			"h5",
			"h6",
			"p",
			"span",
			"strong",
			"em",
			"b",
			"i",
			"u",
			"br",
			"ul",
			"ol",
			"li",
			"blockquote",
			"code",
			"pre",
		],
		ALLOWED_ATTR: ["style", "class", "id"],
		ALLOW_DATA_ATTR: false,
		FORBID_TAGS: ["script", "object", "embed", "iframe", "form", "input", "button"],
		FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onblur"],
	});
};

/**
 * Check if content contains HTML tags
 *
 * @param {string} content - The content to check.
 * @return {boolean} True if content contains HTML tags.
 */
export const containsHtml = (content) => {
	return /<[a-z][\s\S]*>/i.test(content);
};
