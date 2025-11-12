/**
 * WordPress dependencies
 */
import { Button } from "@wordpress/components";

/**
 * External dependencies
 */
import { Check, X } from "lucide-react";

/**
 * ActionButtons Component
 *
 * Displays accept/decline buttons above the input when actions have been executed.
 *
 * @param {Object}   props              - The component props.
 * @param {number}   props.pendingCount - Number of pending changes.
 * @param {Function} props.onAccept     - Callback when accept is clicked.
 * @param {Function} props.onDecline    - Callback when decline is clicked.
 * @param {boolean}  props.isSaving     - Whether the post is currently saving.
 * @return {JSX.Element} The ActionButtons component.
 */
const ActionButtons = ({ pendingCount, onAccept, onDecline, isSaving }) => {
	const changeText = pendingCount === 1 ? "change" : "changes";

	return (
		<div className="nfd-editor-chat-action-buttons">
			<div className="nfd-editor-chat-action-buttons__indicator">
				<span className="nfd-editor-chat-action-buttons__indicator-dot" />
				{pendingCount} pending {changeText}
			</div>
			<div className="nfd-editor-chat-action-buttons__buttons">
				<Button
					className="nfd-editor-chat-action-buttons__button nfd-editor-chat-action-buttons__button--decline"
					onClick={onDecline}
					disabled={isSaving}
				>
					<X size={12} />
					Revert All
				</Button>
				<Button
					className="nfd-editor-chat-action-buttons__button nfd-editor-chat-action-buttons__button--accept"
					onClick={onAccept}
					disabled={isSaving}
				>
					<Check size={14} />
					Keep Changes
				</Button>
			</div>
		</div>
	);
};

export default ActionButtons;
