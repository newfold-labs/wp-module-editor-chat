/**
 * WordPress dependencies
 */
import { Button, Dropdown, Spinner } from "@wordpress/components";
import { useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

/**
 * External dependencies
 */
import { History, Trash2 } from "lucide-react";

/**
 * Internal dependencies
 */
import useConversationHistory from "../../hooks/chat/useConversationHistory";
import { formatRelativeTime } from "../../utils/relativeTime";

/**
 * The list shown inside the popover. Mounted only while the popover is open,
 * so the list loads from the first page each time it opens.
 *
 * @param {Object}   props                      Component props.
 * @param {number}   props.activeConversationId Id of the conversation currently open, if any.
 * @param {Function} props.onOpen               (item) => Promise, resumes a conversation.
 * @param {Function} props.onActiveDeleted      Called after the open conversation was deleted.
 * @param {Function} props.onClose              Closes the popover.
 * @return {Element} The history list.
 */
const HistoryList = ({ activeConversationId, onOpen, onActiveDeleted, onClose }) => {
	const { items, isLoading, hasMore, error, loadMore, deleteItem } = useConversationHistory({
		open: true,
	});
	const [actionError, setActionError] = useState(null);

	const handleSelect = async (item) => {
		setActionError(null);
		try {
			await onOpen(item);
			onClose();
		} catch {
			setActionError(__("Could not open this chat. Please try again.", "wp-module-editor-chat"));
		}
	};

	const handleDelete = async (item) => {
		setActionError(null);
		try {
			await deleteItem(item.id);
			if (item.id === activeConversationId) {
				onActiveDeleted();
			}
		} catch {
			setActionError(__("Could not delete this chat. Please try again.", "wp-module-editor-chat"));
		}
	};

	return (
		<div className="nfd-editor-chat-history">
			{items.length === 0 && !isLoading && !error && (
				<p className="nfd-editor-chat-history__empty">
					{__("No previous chats yet.", "wp-module-editor-chat")}
				</p>
			)}
			{error && items.length === 0 && (
				<p className="nfd-editor-chat-history__error" role="alert">
					{__("Could not load your chats.", "wp-module-editor-chat")}
				</p>
			)}
			{actionError && (
				<p className="nfd-editor-chat-history__error" role="alert">
					{actionError}
				</p>
			)}
			<ul className="nfd-editor-chat-history__list">
				{items.map((item) => (
					<li
						key={item.id}
						className={`nfd-editor-chat-history__row${
							item.id === activeConversationId ? " is-active" : ""
						}`}
					>
						<Button
							className="nfd-editor-chat-history__select"
							onClick={() => handleSelect(item)}
						>
							<span className="nfd-editor-chat-history__title">
								{item.title || __("Untitled chat", "wp-module-editor-chat")}
							</span>
							<span className="nfd-editor-chat-history__time">
								{formatRelativeTime(item.updated_at)}
							</span>
						</Button>
						<Button
							className="nfd-editor-chat-history__delete"
							icon={<Trash2 width={15} height={15} strokeWidth={1.5} />}
							label={__("Delete chat", "wp-module-editor-chat")}
							onClick={() => handleDelete(item)}
						/>
					</li>
				))}
			</ul>
			{isLoading && <Spinner />}
			{hasMore && !isLoading && (
				<Button className="nfd-editor-chat-history__more" variant="link" onClick={loadMore}>
					{__("Load more", "wp-module-editor-chat")}
				</Button>
			)}
		</div>
	);
};

/**
 * ConversationHistoryDropdown — button next to "New chat" that opens the list
 * of the user's previous chats.
 *
 * @param {Object}   props                      Component props.
 * @param {boolean}  props.disabled             Disable while a turn is running.
 * @param {number}   props.activeConversationId Id of the conversation currently open, if any.
 * @param {Function} props.onOpen               (item) => Promise, resumes a conversation.
 * @param {Function} props.onActiveDeleted      Called after the open conversation was deleted.
 * @param {string}   [props.toggleClassName]    Class of the toggle button.
 * @param {Element}  [props.icon]               Icon of the toggle button.
 * @param {boolean}  [props.showTooltip]        Show the label as a tooltip.
 * @return {Element} The dropdown.
 */
const ConversationHistoryDropdown = ({
	disabled = false,
	activeConversationId = null,
	onOpen,
	onActiveDeleted,
	toggleClassName = "nfd-editor-chat-sidebar__history",
	icon = <History width={16} height={16} />,
	showTooltip = false,
}) => (
	<Dropdown
		className="nfd-editor-chat-sidebar__history-wrapper"
		popoverProps={{ placement: "bottom-start" }}
		renderToggle={({ isOpen, onToggle }) => (
			<Button
				icon={icon}
				label={__("Chat history", "wp-module-editor-chat")}
				onClick={onToggle}
				aria-expanded={isOpen}
				className={toggleClassName}
				disabled={disabled}
				showTooltip={showTooltip}
			/>
		)}
		renderContent={({ onClose }) => (
			<HistoryList
				activeConversationId={activeConversationId}
				onOpen={onOpen}
				onActiveDeleted={onActiveDeleted}
				onClose={onClose}
			/>
		)}
	/>
);

export default ConversationHistoryDropdown;
