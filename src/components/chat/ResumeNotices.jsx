/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { X } from "lucide-react";

/**
 * Notices shown above the message list while resuming a stored chat:
 * the different-page prompt, the "page no longer exists" note, the read-only
 * note, and the dismissible page-edited banner.
 *
 * @param {Object}      props                    Component props.
 * @param {Object|null} props.pageConflict       { conversation } when the chat belongs to another page.
 * @param {Function}    props.onResolveConflict  ("navigate" | "continue") => void.
 * @param {boolean}     props.resumedPostMissing Whether the chat's page was deleted or trashed.
 * @param {Function}    props.onDeleteChat       Deletes the open chat.
 * @param {boolean}     props.readOnly           Whether the chat is read-only.
 * @param {boolean}     [props.disabled]     Disable the actions while a turn is running.
 * @param {Object|null} props.driftInfo          { seenAt } when the page was edited since the chat.
 * @param {Function}    props.onDismissDrift     Dismisses the drift banner.
 * @return {Element|null} The notices, or null when there is nothing to show.
 */
const ResumeNotices = ({
	pageConflict,
	onResolveConflict,
	resumedPostMissing,
	onDeleteChat,
	readOnly,
	driftInfo,
	onDismissDrift,
	disabled = false,
}) => {
	if (!pageConflict && !resumedPostMissing && !readOnly && !driftInfo) {
		return null;
	}

	return (
		<div className="nfd-editor-chat-resume-notices">
			{pageConflict && (
				<div className="nfd-editor-chat-resume-notice" role="alert">
					<p>
						{__(
							"This chat was about a different page. Open that page, or continue here in read-only?",
							"wp-module-editor-chat"
						)}
					</p>
					<div className="nfd-editor-chat-resume-notice__actions">
						<Button variant="primary" size="small" disabled={disabled} onClick={() => onResolveConflict("navigate")}>
							{__("Open that page", "wp-module-editor-chat")}
						</Button>
						<Button variant="secondary" size="small" disabled={disabled} onClick={() => onResolveConflict("continue")}>
							{__("Continue here (read-only)", "wp-module-editor-chat")}
						</Button>
					</div>
				</div>
			)}

			{resumedPostMissing && (
				<div className="nfd-editor-chat-resume-notice" role="status">
					<p>
						{__(
							"The page this chat was about no longer exists. The chat is read-only.",
							"wp-module-editor-chat"
						)}
					</p>
					<div className="nfd-editor-chat-resume-notice__actions">
						<Button variant="secondary" size="small" isDestructive disabled={disabled} onClick={onDeleteChat}>
							{__("Delete chat", "wp-module-editor-chat")}
						</Button>
					</div>
				</div>
			)}

			{readOnly && !resumedPostMissing && (
				<div className="nfd-editor-chat-resume-notice" role="status">
					<p>{__("This chat is read-only on this page.", "wp-module-editor-chat")}</p>
				</div>
			)}

			{driftInfo && (
				<div className="nfd-editor-chat-resume-notice is-dismissible" role="status">
					<p>
						{__(
							"This page has been edited since the chat. New requests will use the current page.",
							"wp-module-editor-chat"
						)}
					</p>
					<Button
						className="nfd-editor-chat-resume-notice__dismiss"
						icon={<X width={14} height={14} />}
						label={__("Dismiss", "wp-module-editor-chat")}
						onClick={onDismissDrift}
					/>
				</div>
			)}
		</div>
	);
};

export default ResumeNotices;
