/**
 * Editor Chat - Entry Point
 *
 * Provides the editor-specific chat interface,
 * building on the shared wp-module-ai-chat foundation.
 */

// Import editor-specific styles (which include ai-chat style overrides)
import "./styles/app.scss";

import domReady from "@wordpress/dom-ready";
import { registerPlugin } from "@wordpress/plugins";
import ChatEditor from "./components/ChatEditor";
import { disableWelcomeGuide } from "./utils/disableWelcomeGuide";

// Register the plugin when DOM is ready
domReady(() => {
	disableWelcomeGuide();

	registerPlugin("nfd-editor-chat", {
		render: ChatEditor,
	});
});

// Export components for potential reuse
export { ChatEditor };
