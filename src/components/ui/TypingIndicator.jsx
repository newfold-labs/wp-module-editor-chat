/**
 * WordPress dependencies
 */
import { useState, useEffect } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { Loader2, CheckCircle, XCircle, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import classnames from "classnames";

/**
 * Get ability details for display
 *
 * @param {string} abilityName The ability name
 * @return {Object} { title, description }
 */
const getAbilityDetails = (abilityName) => {
	const abilityMap = {
		"blu/get-global-styles": {
			title: __("Reading Site Colors", "wp-module-editor-chat"),
			description: __(
				"Fetching current color palette and typography settings",
				"wp-module-editor-chat"
			),
		},
		"blu/update-global-palette": {
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
		"mcp-adapter-execute-ability": {
			title: __("Executing Action", "wp-module-editor-chat"),
			description: __("Running WordPress ability", "wp-module-editor-chat"),
		},
	};

	return (
		abilityMap[abilityName] || {
			title:
				abilityName?.replace(/[-_\/]/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) ||
				__("Executing", "wp-module-editor-chat"),
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
		if (abilityName === "blu/update-global-palette" && args?.parameters?.colors) {
			const colorCount = args.parameters.colors.length;
			params = `${colorCount} color${colorCount !== 1 ? "s" : ""}`;
		}

		return { ...details, params };
	}

	return getAbilityDetails(toolName);
};

/**
 * Single tool execution item in the list
 * @param root0
 * @param root0.tool
 * @param root0.isActive
 * @param root0.progress
 * @param root0.isComplete
 * @param root0.isError
 */
const ToolExecutionItem = ({ tool, isActive, progress, isComplete, isError }) => {
	const details = getToolDetails(tool.name, tool.arguments);

	const getIcon = () => {
		if (isError) {
			return (
				<XCircle className="nfd-tool-execution__icon nfd-tool-execution__icon--error" size={12} />
			);
		}
		if (isComplete) {
			return (
				<CheckCircle
					className="nfd-tool-execution__icon nfd-tool-execution__icon--success"
					size={12}
				/>
			);
		}
		if (isActive) {
			return (
				<Loader2 className="nfd-tool-execution__icon nfd-tool-execution__icon--active" size={12} />
			);
		}
		return (
			<Sparkles className="nfd-tool-execution__icon nfd-tool-execution__icon--pending" size={12} />
		);
	};

	return (
		<div
			className={classnames("nfd-tool-execution__item", {
				"nfd-tool-execution__item--active": isActive,
				"nfd-tool-execution__item--complete": isComplete,
				"nfd-tool-execution__item--error": isError,
			})}
		>
			<div className="nfd-tool-execution__item-header">
				{getIcon()}
				<span className="nfd-tool-execution__item-title">{details.title}</span>
				{details.params && (
					<span className="nfd-tool-execution__item-params">{details.params}</span>
				)}
			</div>
			{/* Show progress message when active */}
			{isActive && progress && <div className="nfd-tool-execution__item-progress">{progress}</div>}
		</div>
	);
};

/**
 * TypingIndicator Component
 *
 * Displays an animated typing indicator with spinner and real-time progress.
 * Shows a list of tool executions that persists after completion.
 *
 * @param {Object} props                - The component props.
 * @param {string} props.status         - The current status ('received', 'generating', 'tool_call', 'summarizing', etc.).
 * @param {Object} props.activeToolCall - The currently executing tool call (optional).
 * @param {string} props.toolProgress   - Real-time progress message during tool execution (optional).
 * @param {Array}  props.executedTools  - List of already executed tools (optional).
 * @param {Array}  props.pendingTools   - List of pending tools to execute (optional).
 * @return {JSX.Element} The TypingIndicator component.
 */
const TypingIndicator = ({
	status = null,
	activeToolCall = null,
	toolProgress = null,
	executedTools = [],
	pendingTools = [],
}) => {
	// Track expanded/collapsed state - expanded by default when executing
	const [isExpanded, setIsExpanded] = useState(true);
	const isExecuting = !!activeToolCall;

	// Auto-expand when execution starts, auto-collapse when done
	useEffect(() => {
		setIsExpanded(isExecuting);
	}, [isExecuting]);

	// Get status text based on status
	const getStatusText = () => {
		switch (status) {
			case "received":
				return __("Message received", "wp-module-editor-chat");
			case "generating":
				return __("Thinking", "wp-module-editor-chat");
			case "tool_call":
				return __("Executing actions", "wp-module-editor-chat");
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

	// Check if we have any tool activity to show
	const hasToolActivity = activeToolCall || executedTools.length > 0 || pendingTools.length > 0;
	const totalTools = executedTools.length + (activeToolCall ? 1 : 0) + pendingTools.length;

	// If we have tool activity, show the execution list
	if (hasToolActivity) {
		return (
			<div className="nfd-editor-chat-message nfd-editor-chat-message--assistant">
				<div className="nfd-editor-chat-message__content">
					<div
						className={classnames("nfd-tool-execution", {
							"nfd-tool-execution--collapsed": !isExpanded,
						})}
					>
						{/* Header - clickable toggle */}
						<button
							type="button"
							className="nfd-tool-execution__header"
							onClick={() => setIsExpanded(!isExpanded)}
							aria-expanded={isExpanded}
						>
							{/* Chevron */}
							{isExpanded ? (
								<ChevronDown className="nfd-tool-execution__chevron" size={12} />
							) : (
								<ChevronRight className="nfd-tool-execution__chevron" size={12} />
							)}

							{/* Text */}
							{isExecuting ? (
								<>
									<span>{__("Executing actions", "wp-module-editor-chat")}</span>
									{activeToolCall.total > 1 && (
										<span className="nfd-tool-execution__header-count">
											({activeToolCall.index}/{activeToolCall.total})
										</span>
									)}
								</>
							) : (
								<>
									<span>{__("Actions completed", "wp-module-editor-chat")}</span>
									<span className="nfd-tool-execution__header-count">({totalTools})</span>
								</>
							)}
						</button>

						{/* Tool execution list - collapsible */}
						{isExpanded && (
							<div className="nfd-tool-execution__list">
								{/* Executed tools */}
								{executedTools.map((tool, index) => (
									<ToolExecutionItem
										key={tool.id || `executed-${index}`}
										tool={tool}
										isActive={false}
										isComplete={!tool.isError}
										isError={tool.isError}
										progress={null}
									/>
								))}

								{/* Currently active tool */}
								{activeToolCall && (
									<ToolExecutionItem
										key={activeToolCall.id || "active"}
										tool={activeToolCall}
										isActive={true}
										isComplete={false}
										isError={false}
										progress={toolProgress}
									/>
								)}

								{/* Pending tools */}
								{pendingTools.map((tool, index) => (
									<ToolExecutionItem
										key={tool.id || `pending-${index}`}
										tool={tool}
										isActive={false}
										isComplete={false}
										isError={false}
										progress={null}
									/>
								))}
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
