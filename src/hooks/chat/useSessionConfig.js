/* eslint-disable no-undef, no-console */
/**
 * useSessionConfig — Manages OpenAI client initialization, MCP connection,
 * pattern library setup, and session token refresh.
 */
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";
import apiFetch from "@wordpress/api-fetch";
import OpenAI from "openai";
import { createMCPClient } from "@newfold-labs/wp-module-ai-chat";

import patternLibrary from "../../services/patternLibrary";
import { mcpToolsToOpenAI } from "./conversationUtils";

// Module-level MCP client (created once at import time)
const mcpClient = createMCPClient({ configKey: "nfdEditorChat" });

/**
 * Hook that handles session configuration, OpenAI client setup,
 * MCP tool discovery, and automatic token refresh.
 *
 * @return {{ configStatus: string, openaiClientRef: Object, sessionConfigRef: Object, openaiTools: Array, mcpClient: Object, abortControllerRef: Object }} Session config and client refs
 */
const useSessionConfig = () => {
	const [configStatus, setConfigStatus] = useState("idle"); // idle | loading | ready | error
	const [_mcpStatus, setMcpConnectionStatus] = useState("disconnected");
	const [openaiTools, setOpenaiTools] = useState([]);
	const [configError, setConfigError] = useState(null);

	const openaiClientRef = useRef(null);
	const sessionConfigRef = useRef(null);
	const abortControllerRef = useRef(null);
	const hasInitializedRef = useRef(false);

	// ── Initialization: config fetch + MCP + pattern library ──

	const initialize = useCallback(async () => {
		if (hasInitializedRef.current) {
			return;
		}
		hasInitializedRef.current = true;

		// Fetch config and MCP tools in parallel
		const configPromise = (async () => {
			setConfigStatus("loading");
			try {
				const configUrl = window.nfdEditorChat?.configEndpoint || "";
				if (!configUrl) {
					throw new Error("Config endpoint not configured");
				}

				const config = await apiFetch({ url: configUrl });
				if (!config.session_token || !config.worker_url) {
					throw new Error("Invalid config response");
				}

				sessionConfigRef.current = {
					workerUrl: config.worker_url,
					sessionToken: config.session_token,
					expiresAt: Date.now() + (config.expires_in || 3600) * 1000,
				};

				openaiClientRef.current = new OpenAI({
					apiKey: config.session_token,
					baseURL: config.worker_url,
					dangerouslyAllowBrowser: true,
				});

				setConfigStatus("ready");
			} catch (err) {
				console.error("Failed to fetch editor chat config:", err);
				setConfigStatus("error");
				setConfigError(err.message);
			}
		})();

		const mcpPromise = (async () => {
			try {
				setMcpConnectionStatus("connecting");
				await mcpClient.connect();
				await mcpClient.initialize();
				const availableTools = await mcpClient.listTools();
				setOpenaiTools(mcpToolsToOpenAI(availableTools));
				setMcpConnectionStatus("connected");

				const providerName = window.nfdEditorChat?.patternProvider || "wonderblocks";
				patternLibrary.initialize(providerName).catch(console.warn);
			} catch (err) {
				console.error("Failed to initialize MCP:", err);
				setMcpConnectionStatus("disconnected");
			}
		})();

		await Promise.all([configPromise, mcpPromise]);
	}, []);

	useEffect(() => {
		initialize();
	}, [initialize]);

	// ── Session token refresh ──

	useEffect(() => {
		const config = sessionConfigRef.current;
		if (!config || !config.expiresAt) {
			return;
		}

		// Refresh at 80% of expiry
		const refreshAt = config.expiresAt - Date.now() - (config.expiresAt - Date.now()) * 0.2;
		if (refreshAt <= 0) {
			return;
		}

		const timer = setTimeout(async () => {
			try {
				const configUrl = window.nfdEditorChat?.configEndpoint || "";
				const newConfig = await apiFetch({ url: configUrl });
				if (newConfig.session_token && newConfig.worker_url) {
					sessionConfigRef.current = {
						workerUrl: newConfig.worker_url,
						sessionToken: newConfig.session_token,
						expiresAt: Date.now() + (newConfig.expires_in || 3600) * 1000,
					};
					openaiClientRef.current = new OpenAI({
						apiKey: newConfig.session_token,
						baseURL: newConfig.worker_url,
						dangerouslyAllowBrowser: true,
					});
					console.log("[EditorChat] Session token refreshed");
				}
			} catch (err) {
				console.error("Failed to refresh session token:", err);
			}
		}, refreshAt);

		return () => clearTimeout(timer);
	}, [configStatus]);

	return {
		configStatus,
		configError,
		openaiClientRef,
		sessionConfigRef,
		openaiTools,
		mcpClient,
		abortControllerRef,
	};
};

export default useSessionConfig;
