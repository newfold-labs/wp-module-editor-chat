/**
 * useConversationHistory — cursor-paginated list of the current user's
 * conversations, with optimistic delete (rollback on failure).
 */
import { useCallback, useEffect, useRef, useState } from "@wordpress/element";

import { deleteConversation, listConversations } from "../../services/conversationsApi";

const PAGE_SIZE = 20;

/**
 * @param {Object}  deps      Hook dependencies.
 * @param {boolean} deps.open Whether the history UI is open; the list reloads from page one each time it opens.
 * @return {{items: Array, isLoading: boolean, hasMore: boolean, error: (Error|null), loadMore: Function, deleteItem: Function}} List state and controls.
 */
const useConversationHistory = ({ open }) => {
	const [items, setItems] = useState([]);
	const [cursor, setCursor] = useState(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState(null);

	const itemsRef = useRef(items);
	itemsRef.current = items;
	// Ignore a response that arrives after a newer request was started.
	const requestIdRef = useRef(0);

	const load = useCallback(async (nextCursor = null) => {
		const requestId = ++requestIdRef.current;
		setIsLoading(true);
		setError(null);
		try {
			const result = await listConversations({ limit: PAGE_SIZE, cursor: nextCursor });
			if (requestId !== requestIdRef.current) {
				return;
			}
			setItems((prev) => (nextCursor ? [...prev, ...result.items] : result.items));
			setCursor(result.next_cursor || null);
		} catch (err) {
			if (requestId === requestIdRef.current) {
				setError(err);
			}
		} finally {
			if (requestId === requestIdRef.current) {
				setIsLoading(false);
			}
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

	const deleteItem = useCallback(async (id) => {
		const index = itemsRef.current.findIndex((item) => item.id === id);
		if (index < 0) {
			return;
		}
		const removed = itemsRef.current[index];
		setItems((prev) => prev.filter((item) => item.id !== id));
		try {
			await deleteConversation(id);
		} catch (err) {
			setItems((prev) => {
				const next = [...prev];
				next.splice(Math.min(index, next.length), 0, removed);
				return next;
			});
			throw err;
		}
	}, []);

	return { items, isLoading, hasMore: Boolean(cursor), error, loadMore, deleteItem };
};

export default useConversationHistory;
