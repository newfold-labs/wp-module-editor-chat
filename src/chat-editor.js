/**
 * Styles.
 */
import "./styles/app.scss";

import domReady from "@wordpress/dom-ready";
import { registerPlugin } from "@wordpress/plugins";
import ChatEditor from "./components/ChatEditor";

// Register the plugin when DOM is ready
domReady(() => {
	registerPlugin("nfd-chat-editor", {
		render: ChatEditor,
	});
});

// Export components for potential reuse
export { ChatEditor };
