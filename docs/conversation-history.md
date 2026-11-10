---
name: wp-module-editor-chat
title: Conversation history
description: How Editor Chat stores, lists, resumes and deletes past chats.
updated: 2026-11-10
---

# Conversation history

Editor Chat keeps every chat in a custom WordPress table so a user can list,
reopen and delete past chats from a history dropdown next to "New chat". The
chat that is currently open is also cached in `localStorage`, only so a reload
or crash does not lose it.

Nothing is sent to any external service: conversations live in the site's own
database.

## Storage

Table `{prefix}nfd_editor_chats`, created lazily by
`EditorChatTable::maybe_upgrade()` (hooked on `init`, priority 5) by comparing
`EditorChatTable::DB_VERSION` with the option `nfd_editor_chats_db_version`.
The table has a primary key only, with no secondary index.

| Column | Notes |
|---|---|
| `id` | Auto-increment primary key. |
| `user_id`, `site_url_hash` | Always set by the server. `site_url_hash` is the first 8 characters of `md5(host . path)` of `get_site_url()` (scheme excluded). |
| `post_id`, `post_type` | The page the chat is bound to. |
| `post_modified_seen_at` | `YYYY-MM-DD HH:MM:SS`; the page's last-modified time when the chat last saw it (the drift watermark). |
| `title` | First user message, 60 characters then `…`. Set once, server-side. |
| `messages` | JSON `{"messages": [...], "history": [...]}`: UI messages plus the model-visible history, including `tool_calls` and `tool_results`. |
| `created_at`, `updated_at`, `deleted_at` | GMT. `deleted_at` is set by a soft delete. |

## REST API

Namespace `nfd-editor-chat/v1`. Every route requires `Permissions::is_editor()`
(403 for non-editors, 401 when logged out). Every query is scoped by the current
user and site hash and ignores soft-deleted rows. A row that does not match is
a **404**, never a 403, so another user's conversations are never revealed.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/conversations?limit=&cursor=` | Metadata only (`id`, `title`, `post_id`, `post_type`, `post_modified_seen_at`, `updated_at`), newest first. `limit` defaults to and is capped at 20. Returns `{ items, next_cursor }`; the cursor is opaque and stable across identical `updated_at` values. |
| `GET` | `/conversations/{id}` | Full row with decoded `messages`, plus `post_exists` and `post_status`. |
| `POST` | `/conversations` | Body `post_id`, `post_type`, `post_modified_seen_at`. Creates an empty row, returns `{ id }`. |
| `PUT` | `/conversations/{id}` | Body `messages` (array), `history` (array), optional `post_modified_seen_at`. Replaces the stored payload. 400 `invalid_messages` / `invalid_timestamp` leave the row unchanged. Returns `{ id, updated_at }`. |
| `DELETE` | `/conversations/{id}` | Soft delete. Returns `{ id, deleted: true }`. |

The localized script exposes `window.nfdEditorChat.isEditor`; the history
dropdown is not rendered unless it is truthy (`wp_localize_script` delivers
`"1"` or `""`, not a boolean).

## Client behavior

- **Saving.** `useConversationSync` creates the row on the first user message
  of a new chat and then sends a debounced (1 s) `PUT` whenever messages change.
  It never writes while the chat is read-only or before the editor knows which
  page is open. A failed save is retried on the next change; a `404` drops the
  id so the next message starts a new row.
- **Fallback cache.** `activeChatStorage` keeps the open chat (and its
  `conversationId`) in `localStorage` for 24 hours, only for reload recovery.
- **Migration.** On the first load after rollout, a legacy chat still in
  `localStorage` is pushed to the server, attributed to the page open at that
  moment, then the key is cleared and `nfd-editor-chat-migrated` is set. A
  failure leaves both untouched, so it retries on the next load.
- **Resuming.** Choosing a row loads the conversation and decides:
  - the original page was deleted or trashed: the chat opens read-only with a
    "page no longer exists" note and a delete action;
  - it belongs to a different page: the user chooses to open that page or to
    continue here read-only;
  - it belongs to the open page: messages and model history are restored.
- **Drift.** If the page's current last-modified time is later than
  `post_modified_seen_at`, a dismissible banner appears; it is also dismissed
  when the user sends the next message.
- **Stale tool results.** On the first turn after a resume the request to the
  worker carries one extra system note saying earlier tool results may reference
  blocks that no longer exist and that the current block tree must be re-read.
  The note is never saved with the conversation.
- **Deleting.** The delete icon removes the row optimistically and restores it
  if the request fails.
