/**
 * WordPress dependencies
 */
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { ShieldAlert, Check, X } from "lucide-react";

/**
 * PermissionDialog Component
 *
 * Displays a permission prompt for destructive/non-read-only tool calls.
 * Shows the tools that will be executed and allows the user to approve or deny.
 *
 * @param {Object}   props           Component props
 * @param {Array}    props.toolCalls Array of tool calls that need permission
 * @param {Function} props.onApprove Callback when user approves
 * @param {Function} props.onDeny    Callback when user denies
 * @return {JSX.Element} The PermissionDialog component
 */
const PermissionDialog = ({ toolCalls = [], onApprove, onDeny }) => {
	if (!toolCalls || toolCalls.length === 0) {
		return null;
	}

	/**
	 * Format tool name for display
	 */
	const formatToolName = (name) => {
		return name.replace(/^wp-mcp\//, "").replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
	};

	/**
	 * Get a human-readable description of what the tool will do
	 */
	const getToolDescription = (toolCall) => {
		const { name, arguments: args } = toolCall;

		switch (name) {
			case "wp-mcp/create-post":
				return __(`Create a new post: "${args.title || "Untitled"}"`, "wp-module-editor-chat");
			case "wp-mcp/update-post":
				return __(`Update post ID: ${args.post_id}`, "wp-module-editor-chat");
			case "wp-mcp/delete-post":
				return __(`Delete post ID: ${args.post_id}`, "wp-module-editor-chat");
			default:
				return formatToolName(name);
		}
	};

	return (
		<div className="nfd-permission-dialog">
			<div className="nfd-permission-dialog__header">
				<ShieldAlert className="nfd-permission-dialog__icon" />
				<h4 className="nfd-permission-dialog__title">
					{__("Permission Required", "wp-module-editor-chat")}
				</h4>
			</div>

			<div className="nfd-permission-dialog__body">
				<p className="nfd-permission-dialog__description">
					{__(
						"The AI assistant wants to perform the following action(s) that will modify your site:",
						"wp-module-editor-chat"
					)}
				</p>

				<ul className="nfd-permission-dialog__tool-list">
					{toolCalls.map((toolCall, index) => (
						<li key={toolCall.id || index} className="nfd-permission-dialog__tool-item">
							<span className="nfd-permission-dialog__tool-name">{getToolDescription(toolCall)}</span>
							{toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
								<details className="nfd-permission-dialog__tool-details">
									<summary>{__("View details", "wp-module-editor-chat")}</summary>
									<pre className="nfd-permission-dialog__tool-args">
										{JSON.stringify(toolCall.arguments, null, 2)}
									</pre>
								</details>
							)}
						</li>
					))}
				</ul>

				<p className="nfd-permission-dialog__warning">
					{__("Do you want to allow this?", "wp-module-editor-chat")}
				</p>
			</div>

			<div className="nfd-permission-dialog__actions">
				<button
					type="button"
					className="nfd-permission-dialog__button nfd-permission-dialog__button--deny"
					onClick={onDeny}
				>
					<X size={16} />
					{__("Deny", "wp-module-editor-chat")}
				</button>
				<button
					type="button"
					className="nfd-permission-dialog__button nfd-permission-dialog__button--approve"
					onClick={onApprove}
				>
					<Check size={16} />
					{__("Allow", "wp-module-editor-chat")}
				</button>
			</div>
		</div>
	);
};

export default PermissionDialog;
