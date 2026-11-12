---
name: wp-module-editor-chat
title: Development
description: Lint and test.
updated: 2026-11-12
---

# Development

When cutting a release, update **docs/changelog.md**.

## Linting

- **PHP:** `composer run lint`, `composer run clean` (Newfold PHPCS standard).
- **JavaScript / SCSS:** `npm run lint:js`; stylelint runs via `@wordpress/scripts` in CI on changed SCSS.

## Testing

### JavaScript unit tests

- **Run all:** `npm run test:unit`.
- **Run focused:** `npm run test:unit -- --runTestsByPath path/to/test.js`.
- Jest excludes `tests/playwright/`; Playwright specs run only through the configured brand plugin.

### Vendored browser dependency

Run `npm run vendor` after changing the pinned WebMCP polyfill dependency. This refreshes the checked-in script, license, and version under `js/vendor/webmcp-polyfill/`; do not edit those files by hand.

### Codeception (wpunit)

- **Run:** `composer run test`, `composer run test-coverage` (requires `.env.testing` from `.env.testing.example`).
- **Location:** `tests/wpunit/` — PHP integration tests for REST, editor registration, and related behavior.

### Playwright (end-to-end)

Specs live in **`tests/playwright/`** but execute from a **brand plugin** (for example **wp-plugin-bluehost**), the same pattern as **wp-module-onboarding**. The module workflow **`brand-plugin-test-playwright.yml`** runs those specs on pull requests to `main`.

The reusable editor-abilities scenarios require WordPress 7.0 or newer because the client-side Abilities API is unavailable on older versions. From the configured brand plugin, run:

```bash
npm run test:playwright -- vendor/newfold-labs/wp-module-editor-chat/tests/playwright/specs/editor-chat.spec.js --grep "local editor abilities"
```

The local scenario waits for the public readiness promise, verifies the WebMCP tool, updates a live paragraph, and proves that operation does not call `/blu/mcp`. The disabled-filter scenario installs a temporary must-use plugin through WP-CLI and verifies the existing handler path; cleanup runs after every scenario.

#### What is covered

Suite **`editor-chat.spec.js`** — tag **`@env-local`**, serial execution, Site Editor with `referrer=nfd-editor-chat`:

| Test | Behavior under test |
|------|---------------------|
| Opens and accepts a message | Chat sidebar loads; user message appears; turn completes (input idle). |
| Mocked block edit | Mock worker returns `blu-update-block-attrs`; heading text updates in the editor canvas iframe. |
| Save and reload | Edit is saved (header save or Publish); after reload, updated heading is still visible on the front page template. |
| Stop | Mock completion stays open until abort; Stop shows “Request stopped”; canvas heading unchanged. |
| Worker error | Mock worker returns 500; error alert visible; canvas unchanged. |

Suite **`conversation-history.spec.js`** — tag **`@env-local`**, serial execution, block post editor (`post.php`) with `referrer=nfd-editor-chat` and the same mock worker. It clears the `{prefix}nfd_editor_chats` table before each test:

| Test | Behavior under test |
|------|---------------------|
| Saves the chat to the server | After a turn, the conversation is stored (debounced save) bound to the open page, with the first message as its title. |
| Resumes on the same page | "New chat" clears the thread; the history button lists the chat and choosing it restores the messages with the input enabled. |
| Deletes from the history | The X removes the row; the API answers 404 for it, also after a reload. |
| Different page | Choosing a chat from another page shows the prompt; "Continue here (read-only)" locks the input, "Open that page" navigates to the original page. |
| Trashed page | The chat opens read-only with the "no longer exists" note and "Delete chat" removes it. |

The page editor is used because a Site Editor template has a string id, and chats on those pages are not saved. Run it from the brand plugin like the other spec:

```bash
npm run test:playwright -- vendor/newfold-labs/wp-module-editor-chat/tests/playwright/specs/conversation-history.spec.js
```

#### Layout

| Path | Role |
|------|------|
| `tests/playwright/specs/editor-chat.spec.js` | Core chat scenarios plus local-ability and disabled-filter compatibility coverage. |
| `tests/playwright/specs/conversation-history.spec.js` | Saving, resuming, deleting and the different-page / trashed-page flows for stored chats. |
| `tests/playwright/helpers/editor-chat-flow.js` | Navigation, selectors, WP-CLI page setup, canvas assertions, save helper, plus the conversation-history helpers (REST calls, wait-for-saved, open history). |
| `tests/playwright/helpers/mock-editor-chat-worker.js` | Routes `nfd-editor-chat/v1/config` and a mock CF Worker (`classify-intent`, `chat/completions`). |
| `tests/playwright/helpers/index.js` | Re-exports Bluehost Playwright helpers (`auth`, `wordpress`, `newfold`, …). |
| `tests/playwright/fixtures/mock-worker-streams.js` | OpenAI-style SSE bodies for tool and closing passes. |

Mocks choose **tool vs summarize** responses from the completion request body (nudge / tools), not from a call counter. The **stop** scenario holds the route until the browser aborts the fetch.

### Multi-brand manual checks

1. Clone the target brand plugin and symlink `vendor/newfold-labs/wp-module-editor-chat` to your working copy (same as Bluehost local dev).
2. Open the Site Editor with `referrer=nfd-editor-chat` or use the admin bar **AI Editor** link.
3. Confirm `window.nfdEditorChat.brand.name` matches the host plugin and portal menu items use the correct URLs (onboarding must set `editor_chat_brand` on the container).

```bash
npm install
npm run vendor  # refresh only when the pinned polyfill changes
npm run test:unit
npm run build   # updates build/<version>/chat-editor.js
composer run test
```
