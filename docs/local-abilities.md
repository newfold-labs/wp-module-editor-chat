---
name: wp-module-editor-chat
title: Local editor abilities
description: How the local (in-browser) abilities layer works, and its hooks.
updated: 2026-09-14
---

# Local editor abilities

Some AI tool calls only need information already sitting in the browser — the current block
tree, for example. Those run as local WordPress client-side abilities, bridged to WebMCP
(`document.modelContext`), instead of a round trip to `/blu/mcp`. See
`docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md` for the full design.

This requires **WordPress 7.0+** (the client-side Abilities API). On any site without it, this
layer silently registers zero tools and the module works exactly as it does without it — nothing
here is a hard dependency.

## Where it lives

- `includes/LocalAbilities.php` — enqueues the layer; never touches `/blu/mcp` or `wp-module-mcp`.
- `js/abilities/` — hand-written ESM script modules (no build step): ability definitions
  (`abilities.js`), the WebMCP bridge (`webmcp-bridge.js`), an env probe (`webmcp-polyfill.js`),
  and the bootstrap entry (`index.js`).
- `src/services/localToolRegistry.js` — the chat bundle's consumer side: finds and calls those
  tools via `document.modelContext` (the only surface shared between the script-module world and
  the webpack-bundled chat — see the file's own header comment for why).
- `src/services/toolDispatcher.js` and `src/hooks/chat/useSessionConfig.js` — the two integration
  points; every existing tool path (`blockActions.js`, `/blu/mcp`) is unmodified and remains the
  permanent fallback for any site/session without the local layer.

## Ability names vs. tool names

Ability names use `editor/<slug>` (e.g. `editor/get-editor-tree`); their WebMCP tool name
replaces `/` with `_` (`editor_get-editor-tree`). The `editor_` prefix is how the rest of the
code (dispatcher, logs, merged tool list) tells a local ability apart from a `blu-*` one.

## Hooks

| Hook | Purpose |
| --- | --- |
| `nfd_editor_chat_local_abilities_enabled` | Filter, boolean, default `true`. Return `false` to disable the entire local layer (e.g. for a support investigation) — the module falls back to 100% MCP. |
| `nfd_editor_chat_local_ability_names` | Filter, array, default `['editor/get-editor-tree', 'editor/find-editor-blocks', 'editor/get-block-location', 'editor/get-editor-selection', 'editor/can-insert-block']`. Narrows or extends which registered `editor/*` abilities are bridged to WebMCP (and therefore visible to the model) this request. |

## Verification

1. Console on a post editor screen: `window.nfdEditorAbilities` lists the enabled ability names
   and reports whether WebMCP is supported.
2. `await document.modelContext.getTools()` includes `editor_get-editor-tree`,
   `editor_find-editor-blocks`, `editor_get-block-location`, `editor_get-editor-selection`, and
   `editor_can-insert-block`.
3. A chat prompt that only needs the open document (e.g. "how many blocks are in this post?",
   "find the block that says X", "what's currently selected?", "can I insert an image here?")
   resolves without a `/blu/mcp` request in the Network tab, and
   `[ToolExecutor:REST] Executed local ability editor_<name> (source: local)` appears in the
   console for the ability that ran.
4. On a WordPress install without the client-side Abilities API (or with
   `nfd_editor_chat_local_abilities_enabled` filtered to `false`), the chat behaves exactly as
   it does today — confirms the fail-soft fallback.
