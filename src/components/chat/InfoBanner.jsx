/**
 * InfoBanner — small dismissible/actionable notice shown above the message
 * list. Used for the post-modified drift warning and the "page no longer
 * exists" read-only note.
 */
import { __ } from "@wordpress/i18n";

/**
 * @param {Object}   props
 * @param {string}   props.message      Notice text
 * @param {string}   [props.actionLabel] Label for the action button
 * @param {Function} [props.onAction]    Action button handler (omit to hide the button)
 * @param {Function} [props.onDismiss]   Dismiss handler (omit to hide the dismiss button)
 * @return {Element} The InfoBanner component.
 */
const InfoBanner = ({ message, actionLabel, onAction, onDismiss }) => (
	<div className="nfd-editor-chat-context-warning" role="status">
		<p>{message}</p>
		{actionLabel && onAction && (
			<button type="button" className="nfd-editor-chat-context-warning__btn" onClick={onAction}>
				{actionLabel}
			</button>
		)}
		{onDismiss && (
			<button
				type="button"
				className="nfd-editor-chat-context-warning__btn"
				onClick={onDismiss}
				aria-label={__("Dismiss", "wp-module-editor-chat")}
			>
				{__("Dismiss", "wp-module-editor-chat")}
			</button>
		)}
	</div>
);

export default InfoBanner;
