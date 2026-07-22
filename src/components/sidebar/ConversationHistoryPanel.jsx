/**
 * ConversationHistoryPanel — flat list of conversation rows for the history
 * dropdown. Rename/search/pin are explicitly deferred (see spec), so no
 * grouping or filtering beyond recency order (already sorted server-side).
 */
import { __ } from "@wordpress/i18n";
import { Trash2 } from "lucide-react";

/**
 * @param {string} isoString MySQL datetime string (UTC, "Y-m-d H:i:s")
 * @return {string} Relative time label (e.g. "2m", "3h", "5d")
 */
const getRelativeTime = (isoString) => {
	const date = new Date(`${isoString.replace(" ", "T")}Z`);
	const diffMs = Date.now() - date.getTime();
	const diffM = Math.floor(diffMs / 60000);
	if (diffM < 1) {
		return __("Just now", "wp-module-editor-chat");
	}
	if (diffM < 60) {
		return `${diffM}m`;
	}
	const diffH = Math.floor(diffMs / 3600000);
	if (diffH < 24) {
		return `${diffH}h`;
	}
	const diffD = Math.floor(diffMs / 86400000);
	return `${diffD}d`;
};

/**
 * @param {Object}   props
 * @param {Array}    props.items     Conversation metadata rows
 * @param {boolean}  props.isLoading
 * @param {boolean}  props.hasMore
 * @param {Function} props.onLoadMore
 * @param {Function} props.onSelect  (item) => void
 * @param {Function} props.onDelete  (id) => void
 * @return {Element} The panel content.
 */
const ConversationHistoryPanel = ({ items, isLoading, hasMore, onLoadMore, onSelect, onDelete }) => {
	if (!isLoading && items.length === 0) {
		return (
			<div className="nfd-editor-chat-history-list nfd-editor-chat-history-list--empty">
				{__("No conversations yet.", "wp-module-editor-chat")}
			</div>
		);
	}

	return (
		<div className="nfd-editor-chat-history-list">
			{items.map((item) => (
				<div
					key={item.id}
					className="nfd-editor-chat-history-item"
					role="button"
					tabIndex={0}
					onClick={() => onSelect(item)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onSelect(item);
						}
					}}
				>
					<div className="nfd-editor-chat-history-item__body">
						<div className="nfd-editor-chat-history-item__title-row">
							<span className="nfd-editor-chat-history-item__title">
								{item.title || __("Untitled conversation", "wp-module-editor-chat")}
							</span>
							<span className="nfd-editor-chat-history-item__time">{getRelativeTime(item.updated_at)}</span>
						</div>
					</div>
					<button
						type="button"
						className="nfd-editor-chat-history-item__delete"
						aria-label={__("Delete conversation", "wp-module-editor-chat")}
						onClick={(e) => {
							e.stopPropagation();
							onDelete(item.id);
						}}
					>
						<Trash2 width={14} height={14} aria-hidden="true" />
					</button>
				</div>
			))}
			{hasMore && (
				<button type="button" className="nfd-editor-chat-history-list__load-more" onClick={onLoadMore}>
					{__("Load more", "wp-module-editor-chat")}
				</button>
			)}
		</div>
	);
};

export default ConversationHistoryPanel;
