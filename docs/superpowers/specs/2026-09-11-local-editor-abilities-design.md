# Design: local editor abilities for wp-module-editor-chat

Status: proposed (not yet approved for implementation)
Date: 2026-09-11

## Problem

Today, `wp-module-editor-chat`'s AI can act on the block editor in two ways:

1. A small set of writes (`editBlock`, `addSection`, `moveBlock`, `updateBlockAttrs`) are
   intercepted client-side in `src/services/toolDispatcher.js` and executed directly against
   `wp.data` via `src/services/blockActions.js`.
2. Everything else — including most reads/introspection of the currently open document, and all
   genuine site-management/external-service abilities — goes through a network round trip to
   `/wp-json/blu/mcp` (served by `wp-module-mcp`, itself gatewayed into 3 tools:
   `blu-list-abilities`, `blu-get-ability-schema`, `blu-call-ability`).

Every tool call that only needs information already sitting in the browser (the block tree,
selection state, available block types...) still pays a server round trip. The sibling plugin
`contributor-day-editor-abilities` demonstrates a purely client-side pattern for exactly this
class of operation: it registers WordPress **client-side abilities**
(`@wordpress/abilities`) that read/mutate the live editor via `wp.data`, and bridges them to
**WebMCP** (`document.modelContext.registerTool`) so any tool-calling loop — including this
one — can call them with zero network cost.

## Goal

Move as much of the editor-chat tool surface as possible to local, in-browser execution,
modeled on contributor-day's ability pattern — new ability names, not required to match the
existing `blu-*` server abilities. Abilities that inherently need a server/external call (e.g.
logo generation, palette generation) stay server-side for the generation step itself, but the
step that applies the result to the open document should go through a local ability where
possible.

The local abilities layer depends on the client-side Abilities API, which requires
**WordPress 7.0+** (see "Open technical risk" below) — a version floor `wp-module-editor-chat`
cannot assume for every site it runs on today. The existing `toolDispatcher`/`blockActions`
path (and the full MCP path) is therefore **not a temporary migration step to be deleted** —
it is a permanent fallback the module keeps relying on wherever the local layer isn't
available. Local abilities are added as a faster path *on top of* that, never as a replacement
that removes the ability to run without them. Rollout is incremental in the sense that
abilities are added one at a time and each is verified before the dispatcher prefers it, not in
the sense that anything gets retired afterwards.

## Non-goals

- Not replacing `wp-module-mcp` or the `/wp-json/blu/mcp` endpoint — it remains the path for
  anything that isn't about the currently open document (other posts/pages, media library,
  users, taxonomies) and for abilities that call an external/AI service.
- Not extracting a shared package between `contributor-day-editor-abilities` and
  `wp-module-editor-chat` in this pass. Contributor-day is treated as a reference
  implementation to adapt from, not a runtime dependency. A shared package can be considered
  later if the ability code proves stable and reused by a third consumer.
- Not changing the chat UI. The panel, its components, and the CF-Worker/OpenAI streaming
  transport are unaffected; only where tool calls execute changes.

## Open technical risk to verify before implementation

`contributor-day-editor-abilities` requires **WordPress 7.0+** for `wp_enqueue_script_module`
and the client-side Abilities API, and resolves `@wordpress/abilities` through WordPress's
script-module import map. `wp-module-editor-chat` is built with `@wordpress/scripts` (webpack)
into a classic bundle (`build/2.1.9/chat-editor.js`) and is composed into brand plugins whose
minimum supported WordPress version needs to be confirmed. Before implementation starts,
verify:

- The minimum WordPress version `wp-module-editor-chat` (and the brand plugins that compose it)
  actually needs to support.
- That `@wordpress/abilities` is only available as a script module (not an installable npm
  package), which is why the new ability layer must ship as its own script-module bundle,
  separate from the existing webpack bundle (see Architecture).

If WP 7.0+ cannot be assumed on all target sites, the abilities/WebMCP layer must feature-detect
and no-op gracefully (see Error handling) so the module keeps working unmodified on older sites.

## Architecture

Two tool registries exist side by side during (and after) the migration:

```
                    ┌─────────────────────────────┐
                    │   toolDispatcher.js          │
                    │   (existing entry point,     │
                    │    routing extended inside)   │
                    └──────────────┬───────────────┘
                                   │ tool call from the model
                 ┌─────────────────┼─────────────────┐
                 ▼                                   ▼
     document.modelContext.getTools()        not found locally (not yet
     (new editor/* abilities — local)         migrated, or API unavailable)
                 │                                     │
                 ▼                                     ▼
     executeTool() → ability callback        existing legacy path, kept
     (wp.data, no network)                    permanently as fallback:
                                               blockActions.js handler →
                                               callAbility() → MCP
```

1. **Local (new).** A `js/abilities/` layer inside `wp-module-editor-chat`, modeled on
   contributor-day's `js/abilities.js` + `js/webmcp-bridge.js`: ability definitions with
   `input_schema`/`output_schema`, callbacks reading/mutating `core/block-editor` via
   `wp.data`, bridged to `document.modelContext.registerTool()`. Covers everything about the
   currently open document: tree read, find, block location, insert, move, update, transform,
   remove, selection, select, can-insert, block types, patterns — a superset of what
   `blockActions.js` covers today (also folds in `addSection` and any editor-enhancer-specific
   actions as new abilities).
2. **Remote (unchanged in shape).** `/wp-json/blu/mcp` via `wp-module-mcp`, for anything not
   about the open document, and for abilities that call an external service. When such an
   ability produces a result that needs to land in the editor (e.g., "apply this generated
   palette"), the applying step is a local ability call, not a second server round trip.

**Why a separate script-module bundle, not the existing webpack bundle:** `@wordpress/abilities`
is consumed today only through WordPress's script-module import map, not as an npm package
bundlable by webpack. Rather than fight the build system, the new ability layer ships as its
own PHP-enqueued script modules — exactly the mechanism contributor-day already uses — decoupled
from the React chat bundle. The only coupling point between the two is the shared
`document.modelContext` browser global; there is no direct JS import between the ability layer
and the chat bundle.

## Components

New files, hand-written ESM, no build step (mirrors contributor-day's `js/`):

| File | Role |
| --- | --- |
| `js/abilities/abilities.js` | `editor/*` ability definitions — port of contributor-day's 20, plus new ones covering the same ground as `blockActions.js` (e.g. `editor/add-section`); `blockActions.js` itself is not touched |
| `js/abilities/webmcp-bridge.js` | Bridges abilities to `document.modelContext.registerTool`; feature-detects; treats "already registered" as success |
| `js/abilities/index.js` | Bootstrap: registers abilities then bridges them; exposes `window.nfdEditorAbilities` for debugging (mirrors contributor-day's `window.contributorDayEditorAbilities`) |
| `js/vendor/webmcp-polyfill/` + `bin/vendor-webmcp-polyfill.sh` | Vendored `@mcp-b/webmcp-polyfill`, same reasoning as contributor-day (its ESM build imports a bare specifier the import map can't resolve, so the IIFE build is enqueued as a classic script) |

New PHP: `includes/LocalAbilities.php`, class `LocalAbilities` in the existing
`NewfoldLabs\WP\Module\EditorChat` namespace — same shape as `ChatEditor`/`Permissions`
(constructor registers hooks, static methods do the work), instantiated once alongside
`ChatEditor` in `Application.php`. It is the *only* place the local-abilities layer touches
PHP, so anyone looking for "where does the editor/local stuff get loaded" has exactly one file
to open, distinct from `ChatEditor.php` (chat REST + assets) and `Permissions.php` (capability
checks). Its constructor hooks `enqueue_block_editor_assets` and, in that callback:
- `wp_enqueue_script_module( '@wordpress/abilities' )`
- enqueues the vendored polyfill as a classic script (must run before deferred modules —
  no `defer`/`async`)
- registers/enqueues the two new script modules above

Existing files touched (integration points, not rewrites):

- **`toolDispatcher.js`** — before today's routing (legacy local handler, then
  `callAbility()`), check `document.modelContext.getTools()`; if the called name matches, run
  it via `executeTool()` and return — no network. If not found (not registered, or the
  client-side Abilities API isn't available at all), fall through to today's path unchanged.
- **Tool-schema assembly (`conversationUtils.js`, wherever the OpenAI tool list is built from
  MCP abilities)** — also fetch `await document.modelContext.getTools()` and merge those into
  the same list, through the same name-sanitization pipeline already used for MCP tool names,
  with a reserved prefix (`editor_*`) for local tools to avoid collisions with `blu-*` names.
  When a local ability and an existing MCP ability cover the same operation, omit the MCP one
  from *this request's* tool list — the model is steered onto the fast path only when it is
  actually available this session, without touching the MCP ability itself, which stays fully
  registered server-side for sites/sessions where the local one never registered.
- **`blockActions.js` / `src/services/toolHandlers/*.js`** — left in place permanently as the
  fallback for sites/sessions where the client-side Abilities API is unavailable. A new local
  ability is checked for behavior parity against its legacy counterpart (see Testing) before
  the dispatcher is allowed to prefer it, but the legacy handler itself is never removed.

## Code clarity: local (editor) vs. remote (MCP) must be unmistakable

Two execution paths now exist for one tool call, so the design explicitly optimizes for a
reader (or a future contributor) being able to tell, at a glance, which one is in play — in the
file layout, the naming, and the logs, not only in a comment.

- **One PHP class, one job.** `LocalAbilities` (above) is the sole owner of the local-abilities
  PHP surface. It never touches `/blu/mcp`, `wp-module-mcp`, or `ChatEditor.php`'s REST routes —
  that separation is structural, not just a naming convention.
- **A dedicated, named module for the routing decision.** The "try local, then legacy, then
  MCP" logic in `toolDispatcher.js` is not an inline `if`/`else` buried in existing code. It is
  extracted into a small new file, `src/services/localToolRegistry.js`, exporting
  `findLocalTool( name )` and `runLocalTool( name, input )`. `toolDispatcher.js`'s top-level
  function then reads as a short, named sequence — try the local registry, then the legacy
  handler, then `callAbility()` — instead of a routing decision reconstructed from scattered
  conditionals.
- **The prefix is a load-bearing naming rule, not cosmetic.** Every tool name the local layer
  registers starts with `editor_` (already decided, for name-collision safety). This doubles as
  the answer to "is this tool local or MCP?" anywhere a tool name shows up — logs, devtools,
  the merged schema list, a future UI affordance — without needing to trace execution: the
  prefix alone tells you.
- **Every executed tool call is tagged with its origin in logs/telemetry.** Whatever logging
  `toolDispatcher.js` already does for a tool call gains one field, `source: 'local' | 'legacy'
  | 'mcp'`, set at the point of dispatch, not inferred later — so debugging a session never
  requires guessing which path actually ran.
- **Hooks as documented extension points, not ad hoc conditionals.** Two new filters, following
  the existing `nfd-editor-chat` naming and contributor-day's own `contributor_day_chat_*` hook
  style: `nfd_editor_chat_local_abilities_enabled` (bool — lets a site disable the local layer
  outright, e.g. for a support investigation) and `nfd_editor_chat_local_ability_names` (array —
  lets a consumer narrow or extend which ability names the dispatcher is allowed to prefer
  locally). Both are documented in this module's `docs/` alongside the existing hook table
  convention, so "how do I turn this off" or "how do I see which abilities are local" has a
  single, discoverable answer instead of requiring a code read.
- **Writing itself follows the same principle.** Docblocks on the new PHP class/methods and
  JSDoc on the new JS modules state plainly which path each piece belongs to (e.g. "Local
  (WebMCP) ability: ..." vs. "Routes to the remote MCP gateway: ..."), matching the plain,
  explicit style already used in this module's docs and in contributor-day's own README/AGENTS
  files, rather than terse or clever phrasing.

## Data flow (one chat turn)

1. On editor load, PHP enqueues both the existing chat bundle and the new ability script
   modules. `abilities.js` registers the `editor/*` abilities; `webmcp-bridge.js` bridges them
   into `document.modelContext` (via the polyfill if the browser has no native WebMCP).
2. The user sends a message. Wherever the tool list for the model is built today, it now also
   includes `await document.modelContext.getTools()`, merged with the MCP ability list (minus
   any MCP ability whose operation a locally-registered ability already covers this session),
   through one shared name-sanitization step.
3. The model responds with a tool call. `toolDispatcher` checks the local registry first
   (`executeTool()`, no network); if not found, it falls through to the existing path — legacy
   local handler (`blockActions.js`), else `callAbility()` to `/blu/mcp`. Both remain in place
   permanently as the path used whenever the local layer isn't registered.
4. The result returns to the model; `chatLoop.js` continues the round loop as today until a
   text answer is produced.

## Error handling

- A local ability that fails must come back as a readable tool error to the model, never an
  uncaught exception and never a silent no-op on a bad reference (e.g., a stale `clientId` is
  an error, not an insert at the top of the document) — same convention as contributor-day.
- Two distinct outcomes from the local-lookup step must be handled differently:
  - **Not found locally** → fall through silently to the legacy/MCP path. This is the expected,
    normal case for any ability not yet given a local counterpart, and the permanent case on
    any site/session where the client-side Abilities API never registers.
  - **Found but throws** → surface the error to the model. Never silently fall back to MCP in
    this case — that would risk double execution or mask a real bug.
- If the client-side Abilities API isn't available (WP < 7.0, or the script modules fail to
  load), the bridge must fail soft: log a clear console diagnostic, register zero local tools,
  and leave the rest of the flow running exactly as it does today (100% MCP). This is what
  makes the migration backward-compatible without an explicit feature flag.

## Testing

- Baseline diagnostics adapted from contributor-day: a console log line on registration,
  `window.nfdEditorAbilities.webmcp.registered` listing every ability, manual verification of
  `await document.modelContext.getTools()` from devtools, a spot-check of one read ability and
  one write ability before touching the chat at all.
- **Parity check per new local ability**: before the dispatcher is allowed to prefer it over
  the existing `blockActions.js` handler, confirm both produce the same resulting block tree
  for the same input. The old handler is not deleted, so this is a one-time gate on trusting
  the new path, not a gate on removing the old one — both keep running in production depending
  on environment.
- Verify the merged tool-list logic behaves as expected (an MCP ability disappears from the
  list only in a session where its local counterpart actually registered) and that no name
  collides after sanitization.
- Explicit backward-compatibility check: on an environment where the client-side Abilities API
  is unavailable, confirm the chat behaves exactly as it does today (100% MCP) — this validates
  the fail-soft behavior above.
- Follow whatever test conventions already exist in this module (there is an existing test
  setup, per `.env.testing.example`) rather than introducing new test infrastructure.

## Rollout plan (incremental, high level; nothing below ever deletes a legacy code path)

1. Land the new script-module layer (empty/no abilities yet) plus the `toolDispatcher` local
   lookup — a no-op change, verifiable in isolation, with zero effect on existing behavior.
2. Add local abilities for pure reads first (tree, find, location, selection, block types,
   patterns) — purely additive, nothing existing to keep in sync, lowest risk.
3. Add local abilities paralleling the writes `blockActions.js` already covers
   (`editBlock`→`editor/update-block`, `moveBlock`→`editor/move-block`,
   `addSection`→`editor/add-section` or equivalent, `updateBlockAttrs`→`editor/update-block`).
   Once parity is verified, the dispatcher and tool-schema assembly prefer the local one
   whenever it is registered; `blockActions.js` and its dispatch cases stay in the codebase
   unchanged, as the path used on any site/session without the client-side Abilities API.
4. Revisit any remaining `blu-*` "client action stub" abilities (server-authorized,
   client-executed) case by case — each gains a local counterpart the dispatcher can prefer,
   or stays a thin server ability whose result is applied via a local ability call. The
   server-side ability and the MCP path are never removed.

Retiring a legacy path entirely (e.g. if `wp-module-editor-chat`'s supported WordPress floor
is later raised to 7.0+ fleet-wide) is out of scope for this design and would be its own,
separately-approved follow-up.
