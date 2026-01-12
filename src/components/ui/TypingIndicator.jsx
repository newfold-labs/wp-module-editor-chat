/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * Get ability details for display
 * @param {string} abilityName The ability name
 * @return {Object} { title, description, icon }
 */
const getAbilityDetails = (abilityName) => {
	const abilityMap = {
		"nfd-editor-chat/get-global-styles": {
			title: "Reading Site Colors",
			description: "Fetching current color palette and typography settings",
		},
		"nfd-editor-chat/update-global-palette": {
			title: "Updating Site Colors",
			description: "Applying new colors to global styles",
		},
	};

	return (
		abilityMap[abilityName] || {
			title: abilityName,
			description: "Executing action",
			icon: "⚙️",
		}
	);
};

/**
 * Get tool details for display
 * @param {string} toolName The tool name
 * @param {Object} args     The tool arguments
 * @return {Object} { title, description, icon, params }
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

	if (toolName === "mcp-adapter-discover-abilities") {
		return {
			title: "Discovering Actions",
			description: "Finding available WordPress abilities",
			icon: "🔍",
			params: null,
		};
	}

	if (toolName === "mcp-adapter-get-ability-info") {
		return {
			title: "Getting Ability Info",
			description: `Fetching details for ${args?.ability_name || "ability"}`,
			icon: "📋",
			params: null,
		};
	}

	return {
		title: toolName,
		description: "Executing tool",
		icon: "🔧",
		params: null,
	};
};

/**
 * TypingIndicator Component
 *
 * Displays an animated typing indicator with detailed tool call information.
 *
 * @param {Object} props                - The component props.
 * @param {string} props.status         - The current status ('received', 'generating', 'tool_call', 'summarizing', etc.).
 * @param {Object} props.activeToolCall - The currently executing tool call (optional).
 * @return {JSX.Element} The TypingIndicator component.
 */
const TypingIndicator = ({ status = null, activeToolCall = null }) => {
	// If we have an active tool call, show detailed view
	if (activeToolCall) {
		const details = getToolDetails(activeToolCall.name, activeToolCall.arguments);

		return (
			<div className="nfd-editor-chat-message nfd-editor-chat-message--assistant">
				<div className="nfd-editor-chat-message__content">
					<div className="nfd-editor-chat-tool-status">
						<div className="nfd-editor-chat-tool-status__header">
							<span className="nfd-editor-chat-tool-status__icon">{details.icon}</span>
							<span className="nfd-editor-chat-tool-status__title">{details.title}</span>
							<div className="nfd-editor-chat-tool-status__spinner"></div>
						</div>
						<div className="nfd-editor-chat-tool-status__description">
							{details.description}
							{details.params && (
								<span className="nfd-editor-chat-tool-status__params"> • {details.params}</span>
							)}
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Default status text
	const getStatusText = () => {
		switch (status) {
			case "received":
				return { text: __("Message received", "wp-module-editor-chat") };
			case "generating":
				return { text: __("Thinking", "wp-module-editor-chat") };
			case "tool_call":
				return { text: __("Executing action", "wp-module-editor-chat") };
			case "summarizing":
				return { text: __("Summarizing results", "wp-module-editor-chat") };
			case "completed":
				return { text: __("Processing", "wp-module-editor-chat") };
			case "failed":
				return { text: __("Error occurred", "wp-module-editor-chat") };
			default:
				return { text: __("Thinking", "wp-module-editor-chat") };
		}
	};

	const statusInfo = getStatusText();

	return (
		<div className="nfd-editor-chat-message nfd-editor-chat-message--assistant">
			<div className="nfd-editor-chat-message__content">
				<div className="nfd-editor-chat-typing-indicator">
					<div className="nfd-editor-chat-typing-indicator__icon">{statusInfo.icon}</div>
					<div className="nfd-editor-chat-typing-indicator__status">{statusInfo.text}</div>
					<div className="nfd-editor-chat-typing-indicator__dots">
						<span></span>
						<span></span>
						<span></span>
					</div>
				</div>
			</div>
		</div>
	);
};

export default TypingIndicator;
