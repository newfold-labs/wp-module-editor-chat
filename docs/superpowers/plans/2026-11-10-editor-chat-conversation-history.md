# Editor Chat Conversation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Editor Chat conversations in a WP custom table and let the user list, reopen and delete past chats from a history dropdown in the sidebar header, safely resuming against the current state of the page.

**Architecture:** A custom table `{prefix}nfd_editor_chats` (created lazily via `dbDelta`) is the primary store, exposed through a REST controller in the existing `nfd-editor-chat/v1` namespace. The client syncs the active chat with a debounced PUT, keeps `localStorage` only as a crash/reload fallback cache for the open chat, and resumes old chats through a small state machine (hydrate / conflict / read-only) that always re-reads the live page instead of trusting stored tool results.

**Tech Stack:** PHP 7.3+ (WP REST API, `$wpdb`, `dbDelta`), React via `@wordpress/element`, `@wordpress/api-fetch`, `@wordpress/data` (`core/editor`), Jest (`npm run test:unit`), wp-browser wpunit (`tests/wpunit`).

**Spec:** Jira PRESS0-4403 "Editor chat history" (problem, solution, acceptance criteria and implementation guide), except where the Global Constraints below say otherwise (no mirror, primary-key-only table).

## Global Constraints

- No server-side mirror: nothing is sent to ai-platform (no mirror class, no cron, no sync endpoint, no hook after PUT/DELETE).
- The table has a primary key only, no secondary index.
- The `messages` column holds JSON `{"messages": [...], "history": [...]}`: UI messages plus the model-visible history (which carries `tool_calls`/`tool_results`).
- The resume note text stays generic ("re-read the current block tree"), because the editor abilities used for re-reading may be unavailable.
- PHP 7.3+; namespace `NewfoldLabs\WP\Module\EditorChat`; follow the code style enforced by `composer run lint` and `npm run lint:js`.
- REST namespace `nfd-editor-chat/v1`; every route's `permission_callback` is `Permissions::is_editor()` (403 for non-editors, 401 logged out).
- Identity is never taken from the client: `user_id = get_current_user_id()`, `site_url_hash` computed server-side (`substr(md5(host . path of get_site_url()), 0, 8)`, scheme excluded).
- Every query is scoped by `id` (when applicable) AND `user_id` AND `site_url_hash` AND `deleted_at IS NULL`; a non-matching row returns **404**, never 403.
- List page size: default and max **20**; cursor pagination; list responses never include `messages`.
- Soft delete only (`deleted_at`).
- Save debounce: **1000 ms**. Typing and streaming must never be blocked by a save.
- `localStorage` migration flag key: `nfd-editor-chat-migrated`.
- Page-modified timestamps are exchanged as `"YYYY-MM-DD HH:MM:SS"` (site-local, as returned by `core/editor` `getCurrentPost().modified` with `T` replaced by a space).
- Strings: JS text domain `wp-module-editor-chat`, PHP text domain as used by the surrounding `includes/` files. Never hardcode a brand name in user-facing strings.
- Do not rebuild or commit `build/` output; that belongs to release.
- Update `docs/index.md` and add docs for new behavior (Task 12).

## Review Focus

- A PUT/GET/DELETE on another user's conversation, or one created under another site hash, returns 404 and leaves the row untouched (Task 2).
- PUT with a non-array `messages`/`history`, or malformed `post_modified_seen_at`, returns 400 and does not overwrite the stored row (Task 2).
- Two conversations with identical `updated_at` do not duplicate or skip rows across cursor pages (Task 3).
- The editor loads with `getCurrentPostId() === 0` (Site Editor resolves the post asynchronously): nothing is created or migrated until it resolves (Tasks 7, 8).
- A PUT answered with 404 (conversation deleted elsewhere) stops syncing that id, clears the local cache's id, and the next user message creates a fresh row instead of looping (Task 7).
- The user navigates to a different page while a conversation is active: the row stays bound to its original post and its drift watermark is not advanced from the other page (Task 7).
- A stored chat with `timestamp` as an ISO string (Dates are serialized) and with transient `hasActions`/`undoData` stripped still renders after resume (Tasks 5, 10).
- Opening a history row while a turn is streaming must not corrupt the running turn: history is disabled while loading (Task 11).

---

## File Structure

| File | Responsibility |
|---|---|
| `includes/Database/EditorChatTable.php` (new) | Table name, schema, version-gated `dbDelta` upgrade |
| `includes/RestApi/ConversationsController.php` (new) | Route registration, scoping, CRUD, cursor list |
| `includes/ChatEditor.php` (modify) | Wire upgrade on `init`, register routes, localize `isEditor` |
| `src/services/conversationsApi.js` (new) | REST client wrappers (create/get/update/delete/list) |
| `src/utils/editorHelpers.js` (modify) | `getCurrentPageType()`, `getCurrentPageModified()` |
| `src/hooks/chat/useConversationSync.js` (new) | Create-on-first-message and debounced PUT |
| `src/hooks/chat/activeChatStorage.js` (modify) | Fallback cache also remembers `conversationId`, `postId` |
| `src/hooks/chat/legacyChatMigration.js` (new) | One-shot localStorage → server migration |
| `src/hooks/chat/useConversationHistory.js` (new) | Paginated list state, optimistic delete with rollback |
| `src/hooks/chat/resumeConversation.js` (new) | Pure resume decision + drift check |
| `src/hooks/chat/resumeNotice.js` (new) | One-shot system note for the first turn after resume |
| `src/hooks/useEditorChatREST.js` (modify) | Compose sync, migration, resume; reset on new chat |
| `src/hooks/chat/chatLoop.js` (modify) | Inject the resume note into the worker request only |
| `src/components/sidebar/ConversationHistoryDropdown.jsx` (new) | Dropdown UI next to "New chat" |
| `src/components/chat/ResumeNotices.jsx` (new) | Drift banner, missing-page note, page-conflict prompt |
| `src/components/sidebar/SidebarHeader.jsx`, `src/components/ChatEditor.jsx`, `src/components/chat/ChatInput.jsx` (modify) | Mount dropdown and notices; read-only input |
| `src/styles/...` (new partials) | Styles for dropdown and notices |
| `tests/wpunit/EditorChatTableWPUnitTest.php`, `tests/wpunit/ConversationsControllerWPUnitTest.php` (new) | PHP tests |
| `docs/conversation-history.md`, `docs/index.md` | Documentation |

Start by creating a feature branch from `main` (`git switch -c feature/PRESS0-4403-editor-chat-history`).

---

### Task 1: Table and lazy upgrade

**Files:**
- Create: `includes/Database/EditorChatTable.php`
- Test: `tests/wpunit/EditorChatTableWPUnitTest.php`

**Interfaces:**
- Produces: `EditorChatTable::DB_VERSION` (`'1.0.0'`), `EditorChatTable::VERSION_OPTION` (`'nfd_editor_chats_db_version'`), `EditorChatTable::get_table_name(): string` (`$wpdb->prefix . 'nfd_editor_chats'`), `EditorChatTable::maybe_upgrade(): void`.

Schema (primary key only): `id BIGINT UNSIGNED AUTO_INCREMENT`, `user_id BIGINT UNSIGNED`, `site_url_hash VARCHAR(8)`, `post_id BIGINT UNSIGNED`, `post_type VARCHAR(20)`, `post_modified_seen_at DATETIME`, `title VARCHAR(255) DEFAULT ''`, `messages LONGTEXT`, `created_at DATETIME`, `updated_at DATETIME`, `deleted_at DATETIME NULL`, `PRIMARY KEY  (id)` (two spaces, as `dbDelta` requires).

- [ ] **Step 1: Write failing tests** in `EditorChatTableWPUnitTest`: `test_table_name_uses_prefix`; `test_maybe_upgrade_creates_table_and_stores_version` (delete the option, drop table, call `maybe_upgrade()`, assert the table exists via `SHOW TABLES LIKE` and the option equals `DB_VERSION`); `test_maybe_upgrade_is_noop_when_version_current` (set option to `DB_VERSION`, drop table, call, assert table still absent).
- [ ] **Step 2: Run** `vendor/bin/codecept run wpunit EditorChatTableWPUnitTest`. Expected: FAIL, class not found.
- [ ] **Step 3: Implement** `EditorChatTable` per the interface above; `maybe_upgrade()` returns early when the stored option equals `DB_VERSION`, otherwise runs `dbDelta()` (require `wp-admin/includes/upgrade.php`) and then updates the option.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add editor chats custom table`.

### Task 2: Conversations controller — create, read, update, delete

**Files:**
- Create: `includes/RestApi/ConversationsController.php`
- Test: `tests/wpunit/ConversationsControllerWPUnitTest.php`

**Interfaces:**
- Consumes: `EditorChatTable` (Task 1), `Permissions::is_editor()`.
- Produces (all `public static`, final class): `register_routes(): void`; `create_conversation( \WP_REST_Request $r )`; `get_conversation( $r )`; `update_conversation( $r )`; `delete_conversation( $r )`; private `get_site_hash(): string`; private `find_row( int $id ): ?object` (scoped as in Global Constraints).
- REST contract:
  - `POST /conversations` body `post_id` (int>0), `post_type` (string), `post_modified_seen_at` → `201`-style success returning `{ "id": int }`; stored `messages` = `{"messages":[],"history":[]}`, `title` = `''`. Missing/invalid → 400 `missing_params`.
  - `GET /conversations/{id}` → `{ id, post_id, post_type, post_modified_seen_at, title, messages: {messages, history}, created_at, updated_at, post_exists: bool, post_status: string|null }`. `post_exists` is false when the post is missing or `trash`.
  - `PUT /conversations/{id}` body `messages` (array), `history` (array), optional `post_modified_seen_at`. Replaces the stored payload, bumps `updated_at`, sets `title` from the first non-empty `role === 'user'` message (60 chars then `…`) only when currently empty. Returns `{ id, updated_at }`. Non-array → 400 `invalid_messages`; bad timestamp (not `YYYY-MM-DD HH:MM:SS`) → 400 `invalid_timestamp`.
  - `DELETE /conversations/{id}` sets `deleted_at`, returns `{ id, deleted: true }`.

- [ ] **Step 1: Write failing tests** (use `rest_do_request` with `wp_set_current_user`; create users with `$this->factory()`): `test_non_editor_gets_403`; `test_logged_out_gets_401`; `test_create_returns_id_and_binds_current_user` (client-sent `user_id`/`site_url_hash` params are ignored); `test_get_returns_full_row_with_post_status`; `test_get_other_users_row_is_404`; `test_get_row_from_other_site_hash_is_404` (insert a row directly with a different hash); `test_put_replaces_messages_and_sets_title`; `test_put_keeps_existing_title`; `test_put_invalid_messages_is_400_and_row_unchanged`; `test_put_invalid_timestamp_is_400`; `test_put_other_users_row_is_404_and_unchanged`; `test_delete_soft_deletes_and_subsequent_get_is_404`; `test_get_reports_post_exists_false_for_trashed_post`.
- [ ] **Step 2: Run** `vendor/bin/codecept run wpunit ConversationsControllerWPUnitTest`. Expected: FAIL.
- [ ] **Step 3: Implement** the controller per the interface; register the four routes (`/conversations`, `/conversations/(?P<id>\d+)`) with `Permissions::is_editor()` as permission callback; use `$wpdb->insert/update` with format arrays and `$wpdb->prepare` for reads.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add conversations REST controller`.

### Task 3: Conversations list with cursor pagination

**Files:**
- Modify: `includes/RestApi/ConversationsController.php` (add `list_conversations( \WP_REST_Request $r )` and the `GET /conversations` route)
- Modify: `tests/wpunit/ConversationsControllerWPUnitTest.php`

**Interfaces:**
- Produces: `GET /conversations?limit=&cursor=` → `{ items: [{ id, title, post_id, post_type, post_modified_seen_at, updated_at }], next_cursor: string|null }`. `limit` clamps to 1–20 (default 20). Order `updated_at DESC, id DESC`. `cursor` is opaque: `base64_encode( "{updated_at}|{id}" )`; the next page is rows with `(updated_at, id) < (cursor_updated_at, cursor_id)`. `next_cursor` is non-null only when the page is full. A malformed cursor is treated as no cursor.

- [ ] **Step 1: Write failing tests:** `test_list_excludes_messages_and_soft_deleted_and_other_users`; `test_list_orders_newest_first`; `test_list_paginates_without_gaps_or_duplicates_with_identical_updated_at` (insert 5 rows sharing one `updated_at`, page with `limit=2`, collect ids across pages, assert all 5 exactly once); `test_list_limit_is_capped_at_20`; `test_list_malformed_cursor_returns_first_page`.
- [ ] **Step 2: Run** the controller test file. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** `list_conversations` and cursor encode/decode helpers (validate decoded shape before use).
- [ ] **Step 4: Run the file.** Expected: all PASS.
- [ ] **Step 5: Commit** `feat: add paginated conversations list`.

### Task 4: Wire into ChatEditor

**Files:**
- Modify: `includes/ChatEditor.php` (constructor around `add_action( 'init', ... ensure_temp_upload_dir )`, `register_rest_routes()`, the `$args` array passed to `wp_localize_script`)
- Test: `tests/wpunit/ChatEditorWPUnitTest.php`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `init` hook (priority 5) calling `EditorChatTable::maybe_upgrade`; `ConversationsController::register_routes()` called from `register_rest_routes()`; localized `nfdEditorChat.isEditor` (`bool`, from `Permissions::is_editor()`).

- [ ] **Step 1: Write failing tests:** `test_constructor_registers_table_upgrade_on_init` (assert `has_action( 'init', array( EditorChatTable::class, 'maybe_upgrade' ) )` after `new ChatEditor()`); `test_conversation_routes_are_registered` (after `do_action( 'rest_api_init' )`, assert the routes exist in `rest_get_server()->get_routes()['/nfd-editor-chat/v1/conversations']`).
- [ ] **Step 2: Run** `vendor/bin/codecept run wpunit ChatEditorWPUnitTest`. Expected: FAIL.
- [ ] **Step 3: Implement** the three wiring changes.
- [ ] **Step 4: Run** `composer run lint` and `vendor/bin/codecept run wpunit`. Expected: lint clean, all PASS.
- [ ] **Step 5: Commit** `feat: wire conversation storage into ChatEditor`.

### Task 5: Client REST wrappers

**Files:**
- Create: `src/services/conversationsApi.js`
- Test: `src/services/test/conversationsApi.test.js`

**Interfaces:**
- Produces (named exports, all use `@wordpress/api-fetch` with `path: "/nfd-editor-chat/v1/conversations..."`): `createConversation({ postId, postType, postModifiedSeenAt }) → Promise<{id}>`; `getConversation(id) → Promise<Conversation>`; `updateConversation(id, { messages, history, postModifiedSeenAt? }) → Promise<{id, updated_at}>`; `deleteConversation(id) → Promise<{id, deleted}>`; `listConversations({ limit = 20, cursor = null }) → Promise<{items, next_cursor}>`. Snake_case body keys (`post_id`, `post_type`, `post_modified_seen_at`).
- `normalizeStoredMessages(messages: Array): Array` — maps a stored UI message back to render shape: `timestamp` string → `Date`; drops `hasActions`, `undoData`, `isStreaming`.

- [ ] **Step 1: Write failing tests** (mock `@wordpress/api-fetch`): each wrapper calls `apiFetch` with the exact `path`, `method` and snake_case `data`; `listConversations` omits `cursor` when null; `normalizeStoredMessages` converts an ISO `timestamp` to a `Date` and strips transient fields while leaving other fields intact.
- [ ] **Step 2: Run** `npx wp-scripts test-unit-jest --runInBand src/services/test/conversationsApi.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add conversations REST client`.

### Task 6: Page identity helpers

**Files:**
- Modify: `src/utils/editorHelpers.js` (next to `getCurrentPageId`)
- Test: `src/utils/test/editorHelpers.pageIdentity.test.js`

**Interfaces:**
- Produces: `getCurrentPageType(): string` (`select("core/editor").getCurrentPostType()`); `getCurrentPageModified(): string` (`getCurrentPost()?.modified`, `T` → space, `""` when unavailable); `isModifiedNewer(current: string, seen: string): boolean` (both non-empty and `current > seen`).

- [ ] **Step 1: Write failing tests** (mock `@wordpress/data` `select`): type is returned; `"2026-11-10T09:30:00"` becomes `"2026-11-10 09:30:00"`; missing post returns `""`; `isModifiedNewer` true when later, false when equal/earlier/either empty.
- [ ] **Step 2: Run** `npx wp-scripts test-unit-jest --runInBand src/utils/test/editorHelpers.pageIdentity.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the three helpers.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add page identity helpers`.

### Task 7: Sync hook and fallback cache

**Files:**
- Create: `src/hooks/chat/useConversationSync.js`
- Modify: `src/hooks/chat/activeChatStorage.js` (persist/return optional `conversationId` and `postId`; `saveActiveChat(messages, history, meta = {})`, `loadActiveChat()` returns `{ messages, history, conversationId: number|null, postId: number|null }`; existing TTL and stripping unchanged)
- Test: `src/hooks/chat/test/useConversationSync.test.js`, `src/hooks/chat/test/activeChatStorage.test.js`

**Interfaces:**
- Consumes: Task 5 wrappers, Task 6 helpers.
- Produces: `useConversationSync({ messages, conversationHistoryRef, initialConversationId = null, initialPostId = null, onConversationChange? }) → { conversationId, conversationPostIdRef, setConversationId(id, postId?), readOnly, setReadOnly(bool), resetSync() }`.
- Behavior: skip the first mount; skip while `readOnly` or `messages.length === 0`; skip while `getCurrentPageId()` is falsy; debounce 1000 ms; if no id, `createConversation` with current page identity then PUT; PUT includes `postModifiedSeenAt` only when `getCurrentPageId() === conversationPostIdRef.current`; any failure is logged and retried on the next messages change; a 404 from PUT clears the id (calls `onConversationChange(null)`) without throwing.

- [ ] **Step 1: Write failing tests:** debounce coalesces rapid changes into one PUT after 1000 ms (fake timers); first message creates then PUTs; no request while `readOnly`; no request when page id is 0; PUT failure does not throw and the next change retries; PUT 404 resets `conversationId` to null and the next message creates a new row; `postModifiedSeenAt` omitted when the current page differs from the bound post. Storage tests: `saveActiveChat` + `loadActiveChat` round-trip `conversationId`/`postId`; entries saved without them load as `null`; TTL expiry still empties.
- [ ] **Step 2: Run** `npx wp-scripts test-unit-jest --runInBand src/hooks/chat/test/useConversationSync.test.js src/hooks/chat/test/activeChatStorage.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook (timer and id in refs, like the surrounding hooks) and the storage extension.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync active chat to server with debounce`.

### Task 8: Legacy chat migration

**Files:**
- Create: `src/hooks/chat/legacyChatMigration.js`
- Test: `src/hooks/chat/test/legacyChatMigration.test.js`

**Interfaces:**
- Produces: `migrateLegacyChat({ postId, postType, postModifiedSeenAt, api = { createConversation, updateConversation }, storage = localStorage }) → Promise<{ migrated: boolean, conversationId: number|null }>`; constant `MIGRATION_FLAG = "nfd-editor-chat-migrated"`.
- Behavior: returns `{migrated:false}` without touching anything when the flag is set or `postId` is falsy; when `loadActiveChat()` has messages, create → update with `{messages, history, postModifiedSeenAt}`; then set the flag and `clearActiveChat()`; with no messages just set the flag. If create or update throws, neither the flag nor the cache is touched and the error is rethrown to the caller.

- [ ] **Step 1: Write failing tests:** flag set → no API calls; `postId` 0 → no API calls, flag untouched; valid legacy chat → create then update called with the legacy payload, flag set, cache cleared; no legacy chat → flag set, no API calls; create throws → flag unset and cache intact; update throws → same; second call after success is a no-op.
- [ ] **Step 2: Run** `npx wp-scripts test-unit-jest --runInBand src/hooks/chat/test/legacyChatMigration.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the module.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: migrate legacy local chat to server`.

### Task 9: History list hook

**Files:**
- Create: `src/hooks/chat/useConversationHistory.js`
- Test: `src/hooks/chat/test/useConversationHistory.test.js`

**Interfaces:**
- Consumes: Task 5 `listConversations`, `deleteConversation`.
- Produces: `useConversationHistory({ open }) → { items, isLoading, hasMore, loadMore(), deleteItem(id): Promise<void>, error }`. Loads page one whenever `open` becomes true; `loadMore` appends using `next_cursor`; `deleteItem` removes the row optimistically, calls DELETE, and on failure reinserts the row at its original index and rethrows.

- [ ] **Step 1: Write failing tests:** loads 20 on open; `loadMore` appends and stops when `next_cursor` is null; `deleteItem` removes immediately then keeps removal on success; on failure restores the row at its original index and rejects; list failure sets `error` and leaves existing items.
- [ ] **Step 2: Run** `npx wp-scripts test-unit-jest --runInBand src/hooks/chat/test/useConversationHistory.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: add conversation history list hook`.

### Task 10: Resume decision, drift and resume note

**Files:**
- Create: `src/hooks/chat/resumeConversation.js`, `src/hooks/chat/resumeNotice.js`
- Modify: `src/hooks/chat/chatLoop.js` (where the request messages for the worker are assembled per turn, next to the per-request editor-context injection)
- Test: `src/hooks/chat/test/resumeConversation.test.js`, `src/hooks/chat/test/resumeNotice.test.js`

**Interfaces:**
- Produces: `resolveResumeMode({ conversation, currentPostId }) → "readonly-missing" | "conflict" | "hydrate"` (post gone/trashed → `readonly-missing`; different post → `conflict`; same post → `hydrate`); `getDriftInfo({ conversation, currentModified }) → { seenAt: string } | null` (uses `isModifiedNewer`); `hydrateConversation(conversation) → { messages, history }` (applies `normalizeStoredMessages`, tolerates `messages` missing keys → empty arrays); `RESUME_NOTICE` (`"Prior tool results in this conversation may reference block clientIds that no longer exist on the current page. Always re-read the current block tree before acting."`); `consumeResumeNotice(ref: {current: boolean}) → {role:"system", content:string} | null` (returns the note once and resets the ref).
- `chatLoop.runChatLoop` deps gain `needsResumeNoticeRef`; when `consumeResumeNotice` returns a note it is added only to the messages sent to the worker for that request, never pushed to `conversationHistoryRef` or `messages`.

- [ ] **Step 1: Write failing tests:** the three `resolveResumeMode` outcomes (missing post, trashed post, other post, same post); drift null when equal/older, object when newer; `hydrateConversation` converts timestamps and defaults empty arrays; `consumeResumeNotice` returns the note once then `null`; a `chatLoop` test (follow `chatLoop.stepCompletion.test.js`) asserting the first request after `needsResumeNoticeRef.current = true` includes the note and the persisted history does not.
- [ ] **Step 2: Run** `npx wp-scripts test-unit-jest --runInBand src/hooks/chat/test/resumeConversation.test.js src/hooks/chat/test/resumeNotice.test.js src/hooks/chat/test/chatLoop.stepCompletion.test.js`. Expected: FAIL on new tests.
- [ ] **Step 3: Implement** the two modules and the `chatLoop` change.
- [ ] **Step 4: Run the same command.** Expected: PASS (existing chatLoop tests included).
- [ ] **Step 5: Commit** `feat: resume decision, drift and re-read note`.

### Task 11: Compose in the chat hook and UI

**Files:**
- Modify: `src/hooks/useEditorChatREST.js` (state init from `loadActiveChat()`, `handleNewChat`, return value), `src/components/ChatEditor.jsx`, `src/components/sidebar/SidebarHeader.jsx`, `src/components/chat/ChatInput.jsx`
- Create: `src/components/sidebar/ConversationHistoryDropdown.jsx`, `src/components/chat/ResumeNotices.jsx`, style partials under `src/styles/` imported from `src/styles/app.scss`

**Interfaces:**
- Consumes: Tasks 5–10.
- `useEditorChatREST()` additionally returns: `readOnly: boolean`, `conversationId`, `openConversation(item): Promise<void>`, `pageConflict: {conversation} | null`, `resolvePageConflict("navigate" | "continue"): void`, `driftInfo: {seenAt} | null`, `dismissDrift(): void`, `resumedPostMissing: boolean`, `deleteCurrentConversation(): Promise<void>`.
- Wiring rules:
  - `useConversationSync` is initialised from the fallback cache (`conversationId`, `postId`).
  - A mount effect runs `migrateLegacyChat` once `getCurrentPageId()` is truthy (reads `useSelect` on `core/editor` `getCurrentPostId`), on success sets the sync id; errors are logged and retried next load.
  - `openConversation`: `getConversation(id)` → `resolveResumeMode` → `hydrate`: set messages and `conversationHistoryRef`, `isFirstMessageRef.current = history.length === 0`, `needsResumeNoticeRef.current = true`, `setConversationId(id, post_id)`, `readOnly=false`, compute `driftInfo`; `conflict`: set `pageConflict`; `readonly-missing`: hydrate with `readOnly=true`, `resumedPostMissing=true`.
  - `resolvePageConflict("navigate")` writes nothing special: it calls `loadEditorEntity(post_type, post_id)` from `src/services/contentNavigation.js`; `"continue"` hydrates read-only against the current page.
  - `dismissDrift` is also called automatically on the next user send.
  - `handleNewChat` additionally calls `resetSync()` and clears `readOnly`, `pageConflict`, `driftInfo`, `resumedPostMissing`.
  - `deleteCurrentConversation` deletes the open row via `deleteConversation`, then behaves like `handleNewChat`.
  - Read-only: `ChatInput` gets `disabled={isLoading || readOnly}` (add a placeholder explaining why); the sidebar shows `ResumeNotices` above the message list.
- UI: `SidebarHeader` renders `ConversationHistoryDropdown` before the "New chat" button only when `window.nfdEditorChat?.isEditor` is true; the dropdown (button + popover list, 20 per page, "Load more", per-row delete icon, row shows title or a localized "Untitled chat" and a relative `updated_at`) is disabled while `isLoading`. `ResumeNotices` renders: the dismissible drift banner with the text "This page has been edited since the chat. New requests will use the current page."; the "page no longer exists" note with a "Delete chat" action; the page-conflict prompt "This chat was about a different page. Open that page, or continue here in read-only?" with buttons "Open that page" / "Continue here (read-only)".

- [ ] **Step 1: Write failing tests** for the pure parts you can exercise in the Jest node environment: `useEditorChatREST` composition is covered by the earlier hook tests, so add a focused test `src/hooks/chat/test/resumeFlow.test.js` that drives `openConversation`-style logic through the exported helpers (`resolveResumeMode`, `getDriftInfo`, `hydrateConversation`) with the three scenarios from the ticket (same page + drift, different page, trashed page) and asserts the resulting state object. Then implement components against the exact interfaces above.
- [ ] **Step 2: Run** `npx wp-scripts test-unit-jest --runInBand src/hooks/chat/test/resumeFlow.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook composition, components and styles per the wiring rules; match the existing sidebar class naming (`nfd-editor-chat-sidebar__*`) and use `@wordpress/components`.
- [ ] **Step 4: Run** `npm run test:unit` and `npm run lint:js`. Expected: all PASS, lint clean.
- [ ] **Step 5: Manual verification in the Lando site** (build with `npm run build` locally for testing only, do not commit `build/`; confirm the active Bluehost plugin copy uses this module checkout first): (a) new chat creates one row after the first message, further turns update it; (b) reload resumes the same row; (c) dropdown lists chats newest-first, "Load more" works past 20; (d) opening a same-page chat restores the full chat instantly and the next turn works; (e) opening a chat for another page shows the prompt and both buttons work; (f) trash the original page → read-only with note and "Delete chat"; (g) edit the page after the chat → drift banner, dismissed on first message; (h) delete a row, and force a failing DELETE (offline) to see rollback; (i) with a pre-existing local chat and no migration flag, the first load creates one row, sets the flag and clears the key; (j) a subscriber gets 403 on every route.
- [ ] **Step 6: Commit** `feat: conversation history UI and resume flow`.

### Task 12: Documentation

**Files:**
- Create: `docs/conversation-history.md` (table schema, REST contract from Tasks 2–3, scoping rules, client flow: sync, migration, resume, drift, read-only, note that nothing is mirrored off-site)
- Modify: `docs/index.md` (add the new doc to the table of contents), `docs/integration.md` (list the new REST routes and the `nfdEditorChat.isEditor` flag)

- [ ] **Step 1: Write the docs** with the exact routes, payload shapes and decisions listed in this plan.
- [ ] **Step 2: Run** `composer run lint` and `npm run lint:js`. Expected: clean.
- [ ] **Step 3: Commit** `docs: document conversation history`.

---

## Self-Review

- **Spec coverage:** history dropdown 20/page (Tasks 3, 9, 11); instant full restore (10, 11); optimistic soft delete with rollback (2, 9); identity scoping and 404s (2); 403 and hidden dropdown (2, 4, 11); debounced async saves (7); migration with flag (8, 11); post binding, conflict prompt, missing page read-only, drift banner, per-turn watermark (2, 6, 7, 10, 11); resume note (10); fallback cache (7); mirror and index intentionally excluded (Global Constraints).
- **Type consistency:** `createConversation/updateConversation` take camelCase and send snake_case (Task 5) and are used that way in Tasks 7–9; `setConversationId(id, postId?)` (Task 7) is what Task 11 calls; `normalizeStoredMessages` (Task 5) is what `hydrateConversation` (Task 10) uses; `isModifiedNewer` (Task 6) is what `getDriftInfo` (Task 10) uses.
- **Known gap:** React component rendering has no Jest coverage (the module's Jest environment is `node`); components are covered by the manual checklist in Task 11 step 5.
