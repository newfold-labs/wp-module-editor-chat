/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { AtSign, X } from "lucide-react";

/**
 * Get a human-readable label for a block name
 *
 * @param {string} blockName - The block name (e.g., "core/paragraph")
 * @return {string} The formatted label
 */
const getBlockLabel = (blockName) => {
	if (!blockName) {
		return "";
	}

	// Remove the namespace prefix (e.g., "core/" or "custom/")
	const cleanName = blockName.split("/").pop();

	// Convert kebab-case to Title Case
	return cleanName
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
};

/**
 * Extract and truncate text content from block content
 *
 * @param {string} content - The raw content (HTML or plain text)
 * @return {string|null} The truncated text or null if no content
 */
const extractBlockText = (content) => {
	if (!content) {
		return null;
	}

	// Remove HTML tags to get plain text
	const plainText = content.replace(/<[^>]*>/g, "").trim();

	if (!plainText) {
		return null;
	}

	// Truncate and add ellipsis if needed
	return plainText;
};

/**
 * ContextTag Component
 *
 * Displays a tag showing the current context (e.g., selected block)
 *
 * @param {Object}   props          Component props
 * @param {Object}   props.block    Single block object to display
 * @param {Function} props.onRemove Optional callback when tag is removed
 * @return {JSX.Element|null} The ContextTag component
 */
const ContextTag = ({ block, onRemove }) => {
	if (!block) {
		return null;
	}

	const blockLabel = getBlockLabel(block.name);
	const metadataName = block.attributes?.metadata?.name;

	// Extract text content for specific block types
	const blockType = block.name.split("/").pop();
	const isTextBlock = ["paragraph", "heading"].includes(blockType);
	const blockContent = block.attributes?.content;
	const extractedText = isTextBlock ? extractBlockText(blockContent) : null;

	// Build display label: use extracted text if available, otherwise use metadata name or default label
	let displayLabel = blockLabel;
	if (metadataName) {
		displayLabel = `${blockLabel}: ${metadataName}`;
	} else if (extractedText) {
		displayLabel = `${blockLabel}: ${extractedText}`;
	}

	// Store full label for tooltip before truncating
	const fullDisplayLabel = displayLabel;

	// Truncate display label to 30 characters max
	if (displayLabel.length > 30) {
		displayLabel = `${displayLabel.substring(0, 30)}...`;
	}

	return (
		<div className="nfd-editor-chat-context-tag" title={fullDisplayLabel}>
			<span className="nfd-editor-chat-context-tag__label">
				<AtSign size={12} />
			</span>
			{onRemove && (
				<button
					className="nfd-editor-chat-context-tag__remove"
					onClick={() => onRemove(block.clientId)}
					aria-label={__("Remove context", "wp-module-editor-chat")}
				>
					<X size={12} />
				</button>
			)}
			<span className="nfd-editor-chat-context-tag__block">{displayLabel}</span>
		</div>
	);
}; // Close ContextTag component

export default ContextTag;
