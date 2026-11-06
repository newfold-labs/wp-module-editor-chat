# Reusable Client-side Editor Abilities Design

**Status:** Approved

**Date:** 2026-11-02

## Intent

`wp-module-editor-chat` will own a reusable set of client-side WordPress
Abilities for inspecting and modifying the live Gutenberg editor. Editor Chat
is the primary consumer, but any other plugin loaded on the same editor page
may use the abilities while `wp-module-editor-chat` is active.

The abilities operate in the browser through `@wordpress/abilities` and
`wp.data`. They intentionally cover state that a PHP or remote MCP server
cannot observe reliably, including unsaved blocks, current selection, editor
history, registered client-side block types, and the current pattern registry.

## Goals

- Register the complete 21-ability surface proven by the earlier
  `improve/wp-abilities` experiment.
- Publish a stable `blu-editor/*` contract that is independent of Editor
  Chat's UI, OpenAI loop, MCP client, and `blu-*` server tools.
- Let other plugins discover and execute the abilities directly through
  `@wordpress/abilities`.
- Expose the same abilities to Editor Chat and browser agents through an
  optional WebMCP bridge.
- Prefer local execution in Editor Chat while preserving the existing
  handlers and MCP gateway as compatibility and special-entity fallbacks.
- Fail soft on WordPress versions that do not provide the client-side
  Abilities API.

## Non-goals

- No backend MCP server or `wp-module-mcp` changes.
- No PHP/server implementation of live editor operations.
- No removal of existing `blu-*` handlers or `/blu/mcp` tools.
- No requirement that a consuming plugin use WebMCP or Editor Chat's UI.
- No support for using these abilities outside a loaded Gutenberg editor.
- No extraction into a separate Composer or npm package in this iteration.

## Constraints

- The module continues to support its existing WordPress and PHP version
  range. Client abilities are additive and require WordPress 7.0 or newer.
- Unsupported environments register no local abilities and retain current
  Editor Chat behavior.
- User-facing strings remain brand-agnostic and use the module text domain.
- Ability callbacks must not import Editor Chat components, hooks, OpenAI
  clients, MCP clients, progress UI, or tool-dispatcher code.
- The reusable layer is available only to users satisfying
  `Permissions::is_editor()`, including screens another plugin opts in.
- Ability names and schemas are public contracts once shipped.
- Every registration and bootstrap path is idempotent because multiple
  consumers may request the shared layer on the same page.

## Public Ability Contract

The namespace is `blu-editor`. The initial public surface is:

### Block-tree and selection reads

- `blu-editor/get-editor-tree`
- `blu-editor/find-editor-blocks`
- `blu-editor/get-block-location`
- `blu-editor/get-editor-selection`
- `blu-editor/can-insert-block`

### Block type and pattern reads

- `blu-editor/get-block-types`
- `blu-editor/get-block-type`
- `blu-editor/get-patterns`
- `blu-editor/get-pattern`
- `blu-editor/get-pattern-categories`

### Editor writes

- `blu-editor/edit-block`
- `blu-editor/insert-block`
- `blu-editor/move-block`
- `blu-editor/remove-block`
- `blu-editor/update-block`
- `blu-editor/transform-block`
- `blu-editor/insert-pattern`
- `blu-editor/create-pattern`

### UI and history actions

- `blu-editor/select-block`
- `blu-editor/undo`
- `blu-editor/redo`

The behavior, input schemas, output schemas, validation, controlled-inner-block
handling, pattern behavior, and special-entity guards use the corresponding
`editor/*` implementations on `improve/wp-abilities` as prior art. They are
ported deliberately rather than merging that divergent branch.

Read-only annotations are applied to the ten read abilities and
`select-block`. Mutating abilities declare accurate destructive and idempotent
annotations. Errors are actionable ability errors; invalid or stale client IDs
must never silently target the document root or another block.

Every public ability completes its supported operation directly. A successful
ability result is never an action descriptor that only Editor Chat knows how
to execute. Operations that require a special entity handler, image generation,
or another chat-specific service fail without mutating and may include typed
fallback metadata. Direct consumers receive that explicit unsupported error;
Editor Chat may interpret the metadata and invoke an allow-listed fallback.

## Reusable Module Boundary

### Native WordPress layer

The reusable layer is a native script-module graph under `js/abilities/`.
It has no webpack dependency and imports `@wordpress/abilities` through
WordPress's script-module import map.

The public script-module identifier is
`@newfold-labs/editor-chat/editor-abilities`. It:

- registers the `blu-editor` ability category;
- registers all enabled abilities idempotently;
- exports the immutable ability-name list;
- exports a `ready` promise resolving to the names successfully registered;
  a failing registration is skipped with a console warning and never aborts
  the remaining abilities or rejects `ready`, and an ability already
  registered by another copy of the module is reused rather than treated as a
  failure;
- exports an idempotent registration function for controlled initialization.

Other plugins should declare this script module as a dependency and then use
`getAbility()`, `getAbilities()`, or `executeAbility()` from
`@wordpress/abilities`. They must not depend on Editor Chat internals or
`document.modelContext`.

### PHP loading API

`EditorAbilities` owns registration and enqueueing of the native modules.
By default it loads only on the Site Editor and post-editor screens where
Editor Chat is enabled, preserving current performance and permissions.
`ChatEditor` requests that enqueue only after its existing private screen
checks succeed; those private checks are not made public or duplicated.

For reuse on another Gutenberg screen, the module exposes:

- `EditorAbilities::enqueue( $with_webmcp = false ): bool`, a public,
  idempotent method that enqueues the native layer and optionally the WebMCP
  adapter;
- `nfd_editor_chat_editor_abilities_enabled`, a boolean kill switch;
- `nfd_editor_chat_editor_ability_names`, an allow-list filter;
- `nfd_editor_chat_should_enqueue_editor_abilities`, allowing another plugin
  to opt a supported editor screen into loading.

The screen filter receives the default decision, current `WP_Screen` (or
`null`), and `$pagenow`, so a consumer can decide without reimplementing
private `ChatEditor` methods. The enqueue method still enforces WordPress
7.0+, script-module support, a block-editor context, and
`Permissions::is_editor()`.

### WebMCP adapter

The WebMCP bridge is a separate adapter over the public ability layer. It:

- waits for the public module's `ready` promise;
- converts `blu-editor/<slug>` to `blu-editor_<slug>`;
- converts WordPress ability schemas and annotations to WebMCP tools;
- executes the underlying ability and preserves structured output and errors;
- uses the vendored polyfill only when native WebMCP is unavailable;
- registers each tool with an `AbortSignal` and exposes an unregister function
  that aborts only the tools it registered (WebMCP's unregistration
  mechanism), leaving other plugins' tools untouched;
- is safe to initialize more than once.

Direct WordPress consumers do not need to load or call this adapter.

## Editor Chat Integration

### Tool discovery

`useSessionConfig` discovers local WebMCP tools independently of MCP
connection health. It merges registered `blu-editor_*` tools into the OpenAI
tool list and subscribes to WebMCP tool-change events to handle asynchronous
registration.

Direct MCP tools superseded by a registered local equivalent are omitted from
the model-facing list when possible. The three generic MCP gateway tools stay
available because they are also the route to unrelated server abilities and
to explicit fallbacks.

### Dispatch

The refactored dispatcher recognizes three origins:

1. `blu-editor_*`: local WebMCP execution;
2. `blu-*`: current client handler or `/blu/mcp` gateway path;
3. all other tool names: normal MCP execution.

Local result handling is integrated through a focused registry/adapter, not by
copying the old branch's monolithic dispatcher diff. Local fallback
descriptors delegate to the existing focused tool handlers. A fallback is
allowed only for an explicit allow-list and only when the local callback
reports that it made no mutation.

Local writes participate in the current abort, snapshot, undo, progress,
`hasChanges`, retry, and final-summary behavior. Read-only local calls receive
the existing larger result budget and are exempt from mutation retry limits.
A local write that fails after mutating (`mutated: true`) still counts as a
block edit, so the atomic undo snapshot covers it; it never produces fallback
metadata and is never executed a second time.

### Overlap and fallback

Local abilities are preferred for ordinary live-editor work. Existing
`blu-*` paths remain available for unsupported WordPress versions, disabled or
failed local registration, and operations requiring mature handling of
navigation entities, template parts, site logos, image generation, or other
server services.

No ability in this project is unregistered from the server. Deduplication is a
per-session model-facing decision.

## Data and Error Semantics

- Ability output is neutral domain data, never chat display copy.
- Write results state whether a mutation occurred and return identifiers or
  locations needed for subsequent calls.
- A successful no-op is distinguishable from a mutation.
- A typed fallback result identifies the approved legacy tool and normalized
  arguments, and confirms that no local mutation occurred.
- A direct consumer treats typed fallback metadata as an unsupported ability
  error; only Editor Chat's adapter may execute the fallback.
- Ordinary validation or execution errors are not silently retried through a
  fallback because doing so could mask defects or duplicate writes.
- Controlled inner blocks and synced patterns are identified explicitly in
  tree output.
- Attribute updates validate registered block schemas, deep-merge nested
  values, support explicit clearing, and verify the resulting editor state.

## Testing Strategy

### Ability tests

- Registration is idempotent and all names use `blu-editor/*`.
- Schemas and annotations match callback behavior.
- Reads cover nested blocks, controlled inner blocks, stale IDs, depth limits,
  searches, block types, and patterns.
- Writes cover valid mutations, locked blocks, invalid nesting, attribute
  validation, explicit clearing, no-ops, and post-dispatch verification.
- Navigation, template-part, site-logo, and synced-pattern boundaries produce
  safe outcomes.

### Adapter and consumer tests

- WebMCP name/schema conversion and error propagation.
- Polyfill/native-context behavior and duplicate registration.
- Public `ready` behavior and filtered registrations, including a failing or
  already-registered ability not blocking the rest.
- WebMCP unregistration of owned tools only, and re-registration afterwards.
- Local/MCP tool merging and asynchronous `toolchange`.
- Dispatcher routing, fallback allow-list, abort, snapshot, `hasChanges`, and
  undo behavior, including undo coverage of a write that failed after
  mutating.
- Retry and read-only classification for every public ability.

### PHP tests

- Supported/unsupported WordPress version gates.
- Default Editor Chat screen loading.
- opt-in loading by another plugin through the public method/filter.
- kill switch and ability allow-list.
- duplicate enqueue calls.

### End-to-end checks

- An Editor Chat turn reads and mutates the live editor without `/blu/mcp`.
- An independent test consumer executes a registered ability directly through
  `@wordpress/abilities`.
- Disabling local abilities restores the current MCP/handler behavior.
- Local failure never causes a duplicate mutation.

## Documentation

Add a reusable Editor Abilities guide covering:

- supported WordPress/editor contexts;
- the 21 public names and schemas;
- PHP loading and filters;
- direct `@wordpress/abilities` consumption;
- optional WebMCP consumption;
- fallback and compatibility behavior;
- an example integration from another plugin.

Update `docs/index.md` and `docs/overview.md` to link to the guide.

## Rollout

Implementation is staged but the public feature is complete only when all 21
abilities and their integration are verified:

1. public loader, registration contract, and WebMCP bridge;
2. block-tree and selection reads;
3. block-type and pattern reads;
4. block writes;
5. pattern writes, UI, and history;
6. Editor Chat integration, compatibility verification, and documentation.

Each stage preserves current Editor Chat behavior when its local layer is
absent.
