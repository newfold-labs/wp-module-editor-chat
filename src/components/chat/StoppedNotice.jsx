import { __ } from "@wordpress/i18n";

/**
 * Marker shown after the message list when the user stopped a request.
 *
 * Without it, Stop is indistinguishable from the chat hanging — the reply just
 * never arrives. Rendered here rather than as a chat message because
 * ChatMessages owns the list and takes no custom renderers.
 *
 * @return {JSX.Element} The stopped marker
 */
const StoppedNotice = () => (
	<div className="nfd-editor-chat-stopped" role="status">
		<span className="nfd-editor-chat-stopped__label">
			{__("Request stopped", "wp-module-editor-chat")}
		</span>
	</div>
);

export default StoppedNotice;
