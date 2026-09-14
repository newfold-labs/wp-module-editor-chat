/**
 * useSessionConfig — Manages OpenAI client initialization, MCP connection,
 * and session token refresh.
 */
import { createMCPClient } from "@newfold/wp-module-ai-chat";
import apiFetch from "@wordpress/api-fetch";
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";
import OpenAI from "openai";

import { mcpToolsToOpenAI } from "./conversationUtils";
import {
	listLocalTools,
	mergeLocalAndMcpTools,
	onLocalToolsChanged,
} from "../../services/localToolRegistry";
import logger from "../../utils/logger";

// Module-level MCP client (created once at import time)
export const mcpClient = createMCPClient({ configKey: "nfdEditorChat" });

// Module-level OpenAI client ref — populated by the hook on first init.
// Exported so blockAI.js can make direct completions without the agent loop.
export const openaiClientRef = { current: null };

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

	// Re-use the module-level ref so blockAI.js can access the client directly.
	// useRef(openaiClientRef) is NOT used — we assign into the module-level object.
	const sessionConfigRef = useRef(null);
	const abortControllerRef = useRef(null);
	const hasInitializedRef = useRef(false);
	const refreshTimerRef = useRef(null);
	// Last-known MCP tool list, so a late local-tool registration (see the
	// toolchange subscription below) can recompute openaiTools without a
	// redundant mcpClient.listTools() round trip.
	const mcpToolsRef = useRef([]);

	// ── Initialization: config fetch + MCP ──

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

		// Local tools are read independently of MCP's health: they need no
		// network, so an MCP outage (or a slow connect) must never keep a
		// purely local question (e.g. "how many blocks are in this post?")
		// from reaching the model. Kept outside the MCP try/catch below on
		// purpose — see docs/local-abilities.md.
		const localToolsPromise = (async () => {
			try {
				return await listLocalTools();
			} catch (err) {
				console.error("Failed to list local editor tools:", err);
				return [];
			}
		})();

		const mcpToolsPromise = (async () => {
			try {
				setMcpConnectionStatus("connecting");
				await mcpClient.connect();
				await mcpClient.initialize();
				const availableTools = await mcpClient.listTools();
				mcpToolsRef.current = availableTools;
				setMcpConnectionStatus("connected");
				return availableTools;
			} catch (err) {
				console.error("Failed to initialize MCP:", err);
				setMcpConnectionStatus("disconnected");
				return [];
			}
		})();

		const toolsPromise = (async () => {
			const [localTools, availableTools] = await Promise.all([localToolsPromise, mcpToolsPromise]);
			setOpenaiTools(mcpToolsToOpenAI(mergeLocalAndMcpTools(localTools, availableTools)));
		})();

		await Promise.all([configPromise, toolsPromise]);
	}, []);

	useEffect(() => {
		initialize();
	}, [initialize]);

	// The local-abilities WebMCP bridge registers asynchronously (see
	// js/abilities/webmcp-bridge.js waitForModelContext()) and can finish
	// after the tool list above was already read once. Recompute openaiTools
	// whenever the set of local tools changes, reusing the last-known MCP
	// tool list rather than reconnecting to MCP again.
	useEffect(() => {
		const unsubscribe = onLocalToolsChanged(async () => {
			const localTools = await listLocalTools();
			setOpenaiTools(mcpToolsToOpenAI(mergeLocalAndMcpTools(localTools, mcpToolsRef.current)));
		});
		return () => unsubscribe?.();
	}, []);

	// ── Session token refresh ──
	// Self-rescheduling: after each successful refresh, scheduleRefresh is
	// called again with the new expiry so the timer keeps running.

	const scheduleRefresh = useCallback(() => {
		if (refreshTimerRef.current) {
			clearTimeout(refreshTimerRef.current);
		}

		const config = sessionConfigRef.current;
		if (!config || !config.expiresAt) {
			return;
		}

		// Refresh at 80% of TTL
		const delay = (config.expiresAt - Date.now()) * 0.8;
		if (delay <= 0) {
			return;
		}

		refreshTimerRef.current = setTimeout(async () => {
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
					logger.log("[EditorChat] Session token refreshed");
					scheduleRefresh();
				}
			} catch (err) {
				console.error("Failed to refresh session token:", err);
			}
		}, delay);
	}, []);

	useEffect(() => {
		if (configStatus === "ready") {
			scheduleRefresh();
		}
		return () => {
			if (refreshTimerRef.current) {
				clearTimeout(refreshTimerRef.current);
			}
		};
	}, [configStatus, scheduleRefresh]);

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
