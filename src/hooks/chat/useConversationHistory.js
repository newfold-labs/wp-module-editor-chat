/**
 * useConversationHistory — cursor-paginated list of the current user's
 * conversations, with optimistic delete (rollback on failure).
 */
import { useCallback, useEffect, useState } from "@wordpress/element";

import { listConversations, deleteConversation } from "../../services/conversationsApi";

/**
 * @param {Object}  deps      Hook dependencies
 * @param {boolean} deps.open Whether the dropdown is open (loads on open)
 * @return {{items: Array, isLoading: boolean, hasMore: boolean, loadMore: Function, deleteItem: Function}} History list state and controls.
 */
const useConversationHistory = ({ open }) => {
	const [items, setItems] = useState([]);
	const [cursor, setCursor] = useState(null);
	const [hasMore, setHasMore] = useState(false);
	const [isLoading, setIsLoading] = useState(false);

	const load = useCallback(async (nextCursor = null) => {
		setIsLoading(true);
		try {
			const result = await listConversations({ limit: 20, cursor: nextCursor });
			setItems((prev) => (nextCursor ? [...prev, ...result.items] : result.items));
			setCursor(result.next_cursor);
			setHasMore(Boolean(result.next_cursor));
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) {
			load(null);
		}
	}, [open, load]);

	const loadMore = useCallback(() => {
		if (cursor) {
			load(cursor);
		}
	}, [cursor, load]);

	const removeOptimistic = useCallback((id) => {
		let removed = null;
		let removedIndex = -1;
		setItems((prev) => {
			removedIndex = prev.findIndex((item) => item.id === id);
			removed = removedIndex >= 0 ? prev[removedIndex] : null;
			return prev.filter((item) => item.id !== id);
		});
		return { removed, removedIndex };
	}, []);

	const restore = useCallback((item, index) => {
		if (!item) {
			return;
		}
		setItems((prev) => {
			const next = [...prev];
			next.splice(Math.min(index, next.length), 0, item);
			return next;
		});
	}, []);

	const deleteItem = useCallback(
		async (id) => {
			const { removed, removedIndex } = removeOptimistic(id);
			try {
				await deleteConversation(id);
			} catch (err) {
				restore(removed, removedIndex);
				throw err;
			}
		},
		[removeOptimistic, restore]
	);

	return { items, isLoading, hasMore, loadMore, deleteItem };
};

export default useConversationHistory;
