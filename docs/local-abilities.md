---
name: wp-module-editor-chat
title: Local editor abilities
description: How the local (in-browser) abilities layer works, and its hooks.
updated: 2026-09-21
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

## Local-first tool deduplication

When a local ability is registered, the editor chat omits its overlapping MCP tool from that
session's model-facing tool list:

- `editor_edit-block` supersedes `blu-edit-block`.
- `editor_move-block` supersedes `blu-move-block`.
- `editor_remove-block` supersedes `blu-delete-block`.
- `editor_update-block` supersedes `blu-update-block-attrs`.

This does not unregister or modify the `blu/*` abilities on `/blu/mcp`; backend-only MCP clients
still receive them. Deduplication follows the tools actually registered in WebMCP rather than the
reported WordPress version. If the local layer is disabled, fails to initialize, or unregisters a
tool, the corresponding `blu-*` tool automatically returns to the chat tool list.

The local writes intentionally reject site-logo, navigation, and template-part mutations that need
the mature legacy handlers. Those errors carry a typed fallback descriptor, which the dispatcher
executes internally through the matching `blu-*` handler. The model receives one result for its
original `editor_*` call and never sees both overlapping tools. Invalid input, locked blocks, and
ordinary execution failures have no fallback descriptor and are not retried automatically.

## Inserting at the document root

In the Site Editor the document root is the template, whose block list is locked while a page is
being edited; the page body lives inside `core/post-content`. `editor/insert-block` and
`editor/insert-pattern` therefore retarget a root-level insert to that wrapper when the literal
root refuses the block — the same resolution `getEffectiveRootBlocks()` in
`src/utils/blockUtils.js` does for the legacy path. On a template (where a root insert is
legitimate) and in the post editor (no `core/post-content` block) the requested location is left
untouched. When a destination still refuses the block, the error names the `blu-*` tool to retry
with, so the model has a route out instead of reporting failure.

## Hooks

| Hook | Purpose |
| --- | --- |
| `nfd_editor_chat_local_abilities_enabled` | Filter, boolean, default `true`. Return `false` to disable the entire local layer (e.g. for a support investigation) — the module falls back to 100% MCP. |
| `nfd_editor_chat_local_ability_names` | Filter, array, default the 21 `editor/*` names (block-tree reads, block-type/pattern reads, edit/insert/move/update/remove/transform/select/undo/redo/patterns). Narrows or extends which registered `editor/*` abilities are bridged to WebMCP (and therefore visible to the model) this request. |

## Verification

1. Console on a post editor screen: `window.nfdEditorAbilities` lists the enabled ability names
   and reports whether WebMCP is supported.
2. `await document.modelContext.getTools()` includes the 21 `editor_*` tools (tree/find/location/
   selection/can-insert, block types, patterns, edit/insert/move/update/remove/transform/select/
   undo/redo).
3. A chat prompt that only needs the open document, or asks for a plain insert/move/delete/attribute
   change on an ordinary block (e.g. "how many blocks are in this post?", "insert a paragraph after
   the heading", "make this heading bold"), resolves without a `/blu/mcp`
   request in the Network tab, and `[ToolExecutor:REST] Executed local ability editor_<name>
   (source: local)` appears in the console for the ability that ran.
4. The same kind of request against a block inside the site's navigation menu, inside a template
   part (header/footer), or against `core/site-logo`, still works — the local tool returns a typed
   fallback and the dispatcher runs the legacy handler internally. Markup-based section inserts
   still use `blu-add-section`.
5. On a WordPress install without the client-side Abilities API (or with
   `nfd_editor_chat_local_abilities_enabled` filtered to `false`), the chat behaves exactly as
   it does today — confirms the fail-soft fallback.
