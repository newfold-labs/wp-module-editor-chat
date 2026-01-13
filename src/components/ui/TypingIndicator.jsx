/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Loader2 } from "lucide-react";

/**
 * Get ability details for display
 *
 * @param {string} abilityName The ability name
 * @return {Object} { title, description }
 */
const getAbilityDetails = (abilityName) => {
	const abilityMap = {
		"nfd-editor-chat/get-global-styles": {
			title: __("Reading Site Colors", "wp-module-editor-chat"),
			description: __("Fetching current color palette and typography settings", "wp-module-editor-chat"),
		},
		"nfd-editor-chat/update-global-palette": {
			title: __("Updating Site Colors", "wp-module-editor-chat"),
			description: __("Applying new colors to global styles", "wp-module-editor-chat"),
		},
		"mcp-adapter-discover-abilities": {
			title: __("Discovering Actions", "wp-module-editor-chat"),
			description: __("Finding available WordPress abilities", "wp-module-editor-chat"),
		},
		"mcp-adapter-get-ability-info": {
			title: __("Getting Ability Info", "wp-module-editor-chat"),
			description: __("Fetching ability details", "wp-module-editor-chat"),
		},
	};

	return (
		abilityMap[abilityName] || {
			title: abilityName?.replace(/[-_]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) || __("Executing", "wp-module-editor-chat"),
			description: __("Running action", "wp-module-editor-chat"),
		}
	);
};

/**
 * Get tool details for display
 *
 * @param {string} toolName The tool name
 * @param {Object} args     The tool arguments
 * @return {Object} { title, description, params }
 */
const getToolDetails = (toolName, args = {}) => {
	if (toolName === "mcp-adapter-execute-ability") {
		const abilityName = args?.ability_name || "unknown";
		const details = getAbilityDetails(abilityName);

		// Add specific parameter info
		let params = null;
		if (abilityName === "nfd-editor-chat/update-global-palette" && args?.parameters?.colors) {
			const colorCount = args.parameters.colors.length;
			params = `${colorCount} color${colorCount !== 1 ? "s" : ""}`;
		}

		return { ...details, params };
	}

	return getAbilityDetails(toolName);
};

/**
 * TypingIndicator Component
 *
 * Displays an animated typing indicator with spinner and real-time progress.
 *
 * @param {Object} props                - The component props.
 * @param {string} props.status         - The current status ('received', 'generating', 'tool_call', 'summarizing', etc.).
 * @param {Object} props.activeToolCall - The currently executing tool call (optional).
 * @param {string} props.toolProgress   - Real-time progress message during tool execution (optional).
 * @return {JSX.Element} The TypingIndicator component.
 */
const TypingIndicator = ({ status = null, activeToolCall = null, toolProgress = null }) => {
	// Get status text based on status
	const getStatusText = () => {
		switch (status) {
			case "received":
				return __("Message received", "wp-module-editor-chat");
			case "generating":
				return __("Thinking", "wp-module-editor-chat");
			case "tool_call":
				return __("Executing action", "wp-module-editor-chat");
			case "summarizing":
				return __("Summarizing results", "wp-module-editor-chat");
			case "completed":
				return __("Processing", "wp-module-editor-chat");
			case "failed":
				return __("Error occurred", "wp-module-editor-chat");
			default:
				return __("Thinking", "wp-module-editor-chat");
		}
	};

	// If we have an active tool call, show detailed tool status with streaming progress
	if (activeToolCall) {
		const details = getToolDetails(activeToolCall.name, activeToolCall.arguments);
		const progressIndicator = activeToolCall.total > 1
			? ` (${activeToolCall.index}/${activeToolCall.total})`
			: "";

		return (
			<div className="nfd-editor-chat-message nfd-editor-chat-message--assistant">
				<div className="nfd-editor-chat-message__content">
					<div className="nfd-editor-chat-tool-status">
						<div className="nfd-editor-chat-tool-status__header">
							<Loader2 className="nfd-editor-chat-tool-status__spinner" size={18} />
							<span className="nfd-editor-chat-tool-status__title">
								{details.title}
								{progressIndicator}
							</span>
						</div>
						<div className="nfd-editor-chat-tool-status__description">
							{/* Show real-time progress if available, otherwise show default description */}
							{toolProgress || details.description}
							{details.params && !toolProgress && (
								<span className="nfd-editor-chat-tool-status__params"> • {details.params}</span>
							)}
						</div>
						{/* Show streaming progress indicator */}
						{toolProgress && (
							<div className="nfd-editor-chat-tool-status__progress">
								<div className="nfd-editor-chat-tool-status__progress-bar">
									<div className="nfd-editor-chat-tool-status__progress-fill"></div>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		);
	}

	// Default thinking indicator with spinner
	return (
		<div className="nfd-editor-chat-message nfd-editor-chat-message--assistant">
			<div className="nfd-editor-chat-message__content">
				<div className="nfd-editor-chat-typing-indicator">
					<Loader2 className="nfd-editor-chat-typing-indicator__spinner" size={16} />
					<span className="nfd-editor-chat-typing-indicator__text">{getStatusText()}</span>
				</div>
			</div>
		</div>
	);
};

export default TypingIndicator;
