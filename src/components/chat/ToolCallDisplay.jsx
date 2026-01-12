/**
 * WordPress dependencies
 */
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle, Loader2 } from "lucide-react";
import classnames from "classnames";

/**
 * ToolCallDisplay Component
 *
 * Displays a single tool call with expandable request/response details.
 * Shows status indicators and formatted JSON data.
 *
 * @param {Object}  props              Component props
 * @param {Object}  props.toolCall     The tool call object
 * @param {Object}  props.toolResult   The tool result object (optional)
 * @param {boolean} props.isExecuting  Whether the tool is currently executing
 * @return {JSX.Element} The ToolCallDisplay component
 */
const ToolCallDisplay = ({ toolCall, toolResult, isExecuting = false }) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const { name, arguments: args } = toolCall;
	const hasResult = !!toolResult;
	const isError = toolResult?.isError || toolResult?.error;

	/**
	 * Get status icon based on tool execution state
	 */
	const getStatusIcon = () => {
		if (isExecuting) {
			return <Loader2 className="nfd-tool-call__status-icon nfd-tool-call__status-icon--loading" />;
		}
		if (hasResult) {
			if (isError) {
				return <XCircle className="nfd-tool-call__status-icon nfd-tool-call__status-icon--error" />;
			}
			return <CheckCircle className="nfd-tool-call__status-icon nfd-tool-call__status-icon--success" />;
		}
		return <Wrench className="nfd-tool-call__status-icon nfd-tool-call__status-icon--pending" />;
	};

	/**
	 * Get status text
	 */
	const getStatusText = () => {
		if (isExecuting) {
			return __("Executing...", "wp-module-editor-chat");
		}
		if (hasResult) {
			if (isError) {
				return __("Failed", "wp-module-editor-chat");
			}
			return __("Completed", "wp-module-editor-chat");
		}
		return __("Pending", "wp-module-editor-chat");
	};

	/**
	 * Format tool name for display
	 */
	const formatToolName = (toolName) => {
		// Remove common prefixes and format nicely
		return toolName.replace(/^wp-mcp\//, "").replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
	};

	/**
	 * Format JSON for display
	 */
	const formatJSON = (data) => {
		try {
			if (typeof data === "string") {
				return data;
			}
			return JSON.stringify(data, null, 2);
		} catch {
			return String(data);
		}
	};

	/**
	 * Extract text content from tool result
	 */
	const extractResultText = (result) => {
		if (!result) {
			return null;
		}

		// Handle MCP content array format
		if (Array.isArray(result)) {
			return result
				.map((item) => {
					if (item.text) {
						return item.text;
					}
					if (typeof item === "string") {
						return item;
					}
					return JSON.stringify(item, null, 2);
				})
				.join("\n\n");
		}

		// Handle error string
		if (typeof result === "string") {
			return result;
		}

		// Handle object
		return JSON.stringify(result, null, 2);
	};

	return (
		<div
			className={classnames("nfd-tool-call", {
				"nfd-tool-call--executing": isExecuting,
				"nfd-tool-call--success": hasResult && !isError,
				"nfd-tool-call--error": hasResult && isError,
				"nfd-tool-call--expanded": isExpanded,
			})}
		>
			{/* Header - always visible */}
			<button
				type="button"
				className="nfd-tool-call__header"
				onClick={() => setIsExpanded(!isExpanded)}
				aria-expanded={isExpanded}
			>
				<span className="nfd-tool-call__expand-icon">
					{isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
				</span>

				<span className="nfd-tool-call__icon">{getStatusIcon()}</span>

				<span className="nfd-tool-call__name">{formatToolName(name)}</span>

				<span
					className={classnames("nfd-tool-call__status", {
						"nfd-tool-call__status--executing": isExecuting,
						"nfd-tool-call__status--success": hasResult && !isError,
						"nfd-tool-call__status--error": hasResult && isError,
					})}
				>
					{getStatusText()}
				</span>
			</button>

			{/* Expandable content */}
			{isExpanded && (
				<div className="nfd-tool-call__content">
					{/* Request/Arguments section */}
					<div className="nfd-tool-call__section">
						<div className="nfd-tool-call__section-header">
							{__("Request", "wp-module-editor-chat")}
						</div>
						<pre className="nfd-tool-call__code">{formatJSON(args)}</pre>
					</div>

					{/* Response section */}
					{hasResult && (
						<div className="nfd-tool-call__section">
							<div className="nfd-tool-call__section-header">
								{__("Response", "wp-module-editor-chat")}
							</div>
							{isError ? (
								<div className="nfd-tool-call__error-message">
									{toolResult.error || __("Tool execution failed", "wp-module-editor-chat")}
								</div>
							) : (
								<pre className="nfd-tool-call__code">
									{extractResultText(toolResult.result)}
								</pre>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
};

/**
 * ToolCallsList Component
 *
 * Displays a list of tool calls with their results.
 *
 * @param {Object}  props             Component props
 * @param {Array}   props.toolCalls   Array of tool call objects
 * @param {Array}   props.toolResults Array of tool result objects (optional)
 * @param {boolean} props.isExecuting Whether tools are currently executing
 * @return {JSX.Element} The ToolCallsList component
 */
export const ToolCallsList = ({ toolCalls = [], toolResults = [], isExecuting = false }) => {
	if (!toolCalls || toolCalls.length === 0) {
		return null;
	}

	return (
		<div className="nfd-tool-calls-list">
			<div className="nfd-tool-calls-list__header">
				<Wrench size={14} />
				<span>{__("Tool Calls", "wp-module-editor-chat")}</span>
			</div>
			{toolCalls.map((toolCall, index) => {
				const result = toolResults?.find((r) => r.id === toolCall.id) || toolResults?.[index];

				return (
					<ToolCallDisplay
						key={toolCall.id || index}
						toolCall={toolCall}
						toolResult={result}
						isExecuting={isExecuting && !result}
					/>
				);
			})}
		</div>
	);
};

export default ToolCallDisplay;
