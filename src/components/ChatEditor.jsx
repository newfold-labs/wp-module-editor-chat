/**
 * WordPress dependencies
 */
import { useDispatch } from "@wordpress/data";
import { PluginSidebar, PluginSidebarMoreMenuItem } from "@wordpress/editor";
import { useEffect, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";
import { store as interfaceStore } from "@wordpress/interface";

/**
 * Internal dependencies
 */
import useChat from "../hooks/useChat";
import ActionButtons from "./chat/ActionButtons";
import ChatInput from "./chat/ChatInput";
import ChatMessages from "./chat/ChatMessages";
import WelcomeScreen from "./chat/WelcomeScreen";
import SidebarHeader from "./sidebar/SidebarHeader";
import AILogo from "./ui/AILogo";

const SIDEBAR_NAME = "nfd-editor-chat";
const SIDEBAR_SCOPE = "core";

// ============================================================
// DEV MODE: Set to true to enable manual UI state controls
// ============================================================
const DEV_MODE = false;

/**
 * Development controls for testing tool execution UI states
 */
const DevToolControls = ({ onStateChange, currentState }) => {
	const states = [
		{ key: "idle", label: "Idle (no indicator)" },
		{ key: "generating", label: "Thinking..." },
		{ key: "tool_call_discover", label: "Tool: Discovering" },
		{ key: "tool_call_execute", label: "Tool: Executing Ability" },
		{ key: "tool_call_progress1", label: "Tool: Reading palette" },
		{ key: "tool_call_progress2", label: "Tool: Applying colors" },
		{ key: "tool_call_progress3", label: "Tool: ✓ Colors updated!" },
		{ key: "summarizing", label: "Summarizing..." },
	];

	return (
		<div
			style={{
				padding: "8px",
				background: "#1e1e1e",
				borderBottom: "1px solid #333",
				fontSize: "11px",
			}}
		>
			<div style={{ color: "#f0b429", marginBottom: "6px", fontWeight: "bold" }}>
				🛠 DEV MODE - Tool UI States
			</div>
			<div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
				{states.map((state) => (
					<button
						key={state.key}
						type="button"
						onClick={() => onStateChange(state.key)}
						style={{
							padding: "4px 8px",
							fontSize: "10px",
							background: currentState === state.key ? "#0073aa" : "#333",
							color: "#fff",
							border: "none",
							borderRadius: "3px",
							cursor: "pointer",
						}}
					>
						{state.label}
					</button>
				))}
			</div>
		</div>
	);
};

const ChatEditor = () => {
	const { enableComplementaryArea } = useDispatch(interfaceStore);
	const {
		messages,
		isLoading,
		error,
		status,
		isSaving,
		activeToolCall,
		toolProgress,
		executedTools,
		pendingTools,
		handleSendMessage,
		handleNewChat,
		handleAcceptChanges,
		handleDeclineChanges,
		handleStopRequest,
	} = useChat();

	// DEV MODE: Manual state overrides
	const [devState, setDevState] = useState("idle");
	const getDevOverrides = () => {
		const baseReturn = {
			status,
			activeToolCall,
			toolProgress,
			isLoading,
			executedTools,
			pendingTools,
		};

		if (!DEV_MODE || devState === "idle") {
			return baseReturn;
		}

		// Mock tool for dev mode
		const mockGetStylesTool = {
			id: "dev-get-1",
			name: "mcp-adapter-execute-ability",
			arguments: { ability_name: "blu/get-global-styles", parameters: {} },
		};
		const mockUpdatePaletteTool = {
			id: "dev-update-1",
			name: "mcp-adapter-execute-ability",
			arguments: {
				ability_name: "blu/update-global-palette",
				parameters: { colors: [{ slug: "base", color: "#1a1a1a" }] },
			},
		};

		switch (devState) {
			case "generating":
				return {
					...baseReturn,
					status: "generating",
					activeToolCall: null,
					toolProgress: null,
					isLoading: true,
					executedTools: [],
					pendingTools: [],
				};
			case "tool_call_discover":
				return {
					...baseReturn,
					status: "tool_call",
					activeToolCall: {
						id: "dev-discover",
						name: "mcp-adapter-discover-abilities",
						arguments: {},
						index: 1,
						total: 3,
					},
					toolProgress: "Finding available actions...",
					isLoading: true,
					executedTools: [],
					pendingTools: [mockGetStylesTool, mockUpdatePaletteTool],
				};
			case "tool_call_execute":
				return {
					...baseReturn,
					status: "tool_call",
					activeToolCall: { ...mockGetStylesTool, index: 2, total: 3 },
					toolProgress: null,
					isLoading: true,
					executedTools: [
						{
							id: "dev-discover",
							name: "mcp-adapter-discover-abilities",
							arguments: {},
							isError: false,
						},
					],
					pendingTools: [mockUpdatePaletteTool],
				};
			case "tool_call_progress1":
				return {
					...baseReturn,
					status: "tool_call",
					activeToolCall: { ...mockUpdatePaletteTool, index: 3, total: 3 },
					toolProgress: "Reading current color palette…",
					isLoading: true,
					executedTools: [
						{
							id: "dev-discover",
							name: "mcp-adapter-discover-abilities",
							arguments: {},
							isError: false,
						},
						{ ...mockGetStylesTool, isError: false },
					],
					pendingTools: [],
				};
			case "tool_call_progress2":
				return {
					...baseReturn,
					status: "tool_call",
					activeToolCall: { ...mockUpdatePaletteTool, index: 3, total: 3 },
					toolProgress: "Applying new colors to your site…",
					isLoading: true,
					executedTools: [
						{
							id: "dev-discover",
							name: "mcp-adapter-discover-abilities",
							arguments: {},
							isError: false,
						},
						{ ...mockGetStylesTool, isError: false },
					],
					pendingTools: [],
				};
			case "tool_call_progress3":
				return {
					...baseReturn,
					status: "tool_call",
					activeToolCall: null,
					toolProgress: null,
					isLoading: true,
					executedTools: [
						{
							id: "dev-discover",
							name: "mcp-adapter-discover-abilities",
							arguments: {},
							isError: false,
						},
						{ ...mockGetStylesTool, isError: false },
						{ ...mockUpdatePaletteTool, isError: false },
					],
					pendingTools: [],
				};
			case "summarizing":
				return {
					...baseReturn,
					status: "summarizing",
					activeToolCall: null,
					toolProgress: null,
					isLoading: true,
					executedTools: [
						{
							id: "dev-discover",
							name: "mcp-adapter-discover-abilities",
							arguments: {},
							isError: false,
						},
						{ ...mockGetStylesTool, isError: false },
						{ ...mockUpdatePaletteTool, isError: false },
					],
					pendingTools: [],
				};
			default:
				return baseReturn;
		}
	};

	const devOverrides = getDevOverrides();

	useEffect(() => {
		enableComplementaryArea(SIDEBAR_SCOPE, SIDEBAR_NAME);
	}, [enableComplementaryArea]);

	// Check if there are any messages with pending actions and count them
	const pendingActionsCount = messages.filter((msg) => msg.hasActions).length;
	const hasPendingActions = pendingActionsCount > 0;

	// Disable new chat button when there are no messages (brand new chat)
	const isNewChatDisabled = messages.length === 0;

	return (
		<>
			<PluginSidebarMoreMenuItem
				scope={SIDEBAR_SCOPE}
				target={SIDEBAR_NAME}
				icon={<AILogo width={24} height={24} />}
			>
				{__("AI Chat Editor", "wp-module-editor-chat")}
			</PluginSidebarMoreMenuItem>
			<PluginSidebar
				scope={SIDEBAR_SCOPE}
				identifier={SIDEBAR_NAME}
				className="nfd-editor-chat-sidebar"
				closeLabel={__("Close AI Chat Editor", "wp-module-editor-chat")}
				icon={<AILogo width={24} height={24} />}
				headerClassName="nfd-editor-chat-sidebar__header"
				panelClassName="nfd-editor-chat-sidebar__panel"
				header={<SidebarHeader onNewChat={handleNewChat} isNewChatDisabled={isNewChatDisabled} />}
			>
				{/* DEV MODE: Manual state controls */}
				{DEV_MODE && <DevToolControls onStateChange={setDevState} currentState={devState} />}
				<div className="nfd-editor-chat-sidebar__content">
					{messages.length === 0 ? (
						<WelcomeScreen onSendMessage={handleSendMessage} />
					) : (
						<ChatMessages
							messages={messages}
							isLoading={devOverrides.isLoading}
							error={error}
							status={devOverrides.status}
							activeToolCall={devOverrides.activeToolCall}
							toolProgress={devOverrides.toolProgress}
							executedTools={devOverrides.executedTools}
							pendingTools={devOverrides.pendingTools}
						/>
					)}
					{hasPendingActions && (
						<ActionButtons
							pendingCount={pendingActionsCount}
							onAccept={handleAcceptChanges}
							onDecline={handleDeclineChanges}
							isSaving={isSaving}
						/>
					)}
					<ChatInput
						onSendMessage={handleSendMessage}
						onStopRequest={handleStopRequest}
						disabled={devOverrides.isLoading}
					/>
				</div>
			</PluginSidebar>
		</>
	);
};

export default ChatEditor;
