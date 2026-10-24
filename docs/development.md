---
name: wp-module-editor-chat
title: Development
description: Lint and test.
updated: 2026-10-21
---

# Development

## Linting

- **PHP:** `composer run lint`, `composer run clean` (Newfold PHPCS standard).

## Testing

### Codeception (wpunit)

- **Run:** `composer run test`, `composer run test-coverage` (requires `.env.testing` from `.env.testing.example`).
- **Location:** `tests/wpunit/` — PHP integration tests for REST, editor registration, and related behavior.

### Playwright (end-to-end)

Specs live in **`tests/playwright/`** but execute from a **brand plugin** (for example **wp-plugin-bluehost**), the same pattern as **wp-module-onboarding**. The module workflow **`brand-plugin-test-playwright.yml`** runs those specs on pull requests to `main`.

#### What is covered

Suite **`editor-chat.spec.js`** — tag **`@env-local`**, serial execution, Site Editor with `referrer=nfd-editor-chat`:

| Test | Behavior under test |
|------|---------------------|
| Opens and accepts a message | Chat sidebar loads; user message appears; turn completes (input idle). |
| Mocked block edit | Mock worker returns `blu-update-block-attrs`; heading text updates in the editor canvas iframe. |
| Save and reload | Edit is saved (header save or Publish); after reload, updated heading is still visible on the front page template. |
| Stop | Mock completion stays open until abort; Stop shows “Request stopped”; canvas heading unchanged. |
| Worker error | Mock worker returns 500; error alert visible; canvas unchanged. |

#### Layout

| Path | Role |
|------|------|
| `tests/playwright/specs/editor-chat.spec.js` | Five scenarios above. |
| `tests/playwright/helpers/editor-chat-flow.js` | Navigation, selectors, WP-CLI page setup, canvas assertions, save helper. |
| `tests/playwright/helpers/mock-editor-chat-worker.js` | Routes `nfd-editor-chat/v1/config` and a mock CF Worker (`classify-intent`, `chat/completions`). |
| `tests/playwright/helpers/index.js` | Re-exports Bluehost Playwright helpers (`auth`, `wordpress`, `newfold`, …). |
| `tests/playwright/fixtures/mock-worker-streams.js` | OpenAI-style SSE bodies for tool and closing passes. |

Mocks choose **tool vs summarize** responses from the completion request body (nudge / tools), not from a call counter. The **stop** scenario holds the route until the browser aborts the fetch.
