# Design: local editor abilities — Stage 2, block-tree read abilities

Status: proposed (not yet approved for implementation)
Date: 2026-09-14

## Problem

`docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md` (the approved design) lays
out an incremental rollout of local, in-browser editor abilities. Rollout Stage 1 — the
script-module infrastructure plus exactly one ability, `editor/get-editor-tree` — is implemented
and verified (`docs/superpowers/plans/2026-09-11-local-editor-abilities-infra.md`).

Stage 2 of that rollout is "local abilities for pure reads first (tree, find, location,
selection, block types, patterns) — purely additive, nothing existing to keep in sync, lowest
risk." The remaining pure-read abilities span three loosely related domains (block-tree
introspection, block-type introspection, patterns). This design covers only the first domain —
**block-tree reads** — as its own plan; block types and patterns are separate follow-up plans.

## Goal

Add four local (in-browser) editor abilities, ported from the reference implementation
`contributor-day-editor-abilities` (`js/abilities.js`), covering block-tree introspection beyond
what `editor/get-editor-tree` already provides:

- `editor/find-editor-blocks` — find blocks by visible text, block name, and/or attribute value.
- `editor/get-block-location` — hierarchical location (parents, root, index, path) of a block.
- `editor/get-editor-selection` — the current block and rich-text selection.
- `editor/can-insert-block` — whether a block type can be inserted at a given location.

These are a faithful port: same `input_schema`/`output_schema`/callback behavior as the
reference implementation, adapted only to this module's existing conventions (the
`assertEditorReady`/`getData`/`serializeBlock`/`ensureAbility` helpers Stage 1 already ported).

## Non-goals

- Not the block-types abilities (`editor/get-block-types`, `editor/get-block-type`) or the
  patterns abilities (`editor/get-patterns`, `editor/get-pattern`,
  `editor/get-pattern-categories`) — separate plans, per the family split agreed for Stage 2.
- Not any write ability (`insert-block`, `move-block`, `update-block`, `remove-block`,
  `transform-block`, `select-block`, `undo`/`redo`, `insert-pattern`, `create-pattern`) — Rollout
  Stage 3+ in the approved design, which also requires a parity check against `blockActions.js`
  that pure reads do not need.
- Not a change to the local-abilities infrastructure itself (the WebMCP bridge, the bootstrap
  script, `localToolRegistry.js`, `toolDispatcher.js`, `useSessionConfig.js`). Stage 1 built that
  layer to be generic over any ability name PHP enables; this plan only adds ability
  registrations and extends the enabled-names default.

## Architecture

Unchanged from the approved design and from Stage 1's implementation of it. Confirmed by reading
the current code: every integration point downstream of `js/abilities/abilities.js` already
operates generically over whatever ability names
`LocalAbilities::get_enabled_ability_names()` returns —

- `js/abilities/webmcp-bridge.js` bridges any ability found via `getAbility()`/`getTools()`; it
  has no ability-name-specific logic.
- `js/abilities/index.js` filters `registerEditorAbilities()`'s return value against the
  PHP-supplied allow-list; it does not enumerate ability names itself.
- `src/services/localToolRegistry.js`, `src/services/toolDispatcher.js`, and
  `src/hooks/chat/useSessionConfig.js` all operate on `document.modelContext.getTools()` /
  `editor_*`-prefixed tool names generically.

So this plan touches exactly two functional files: `js/abilities/abilities.js` (new ability
registrations + their shared helpers) and `includes/LocalAbilities.php` (the enabled-names
default), plus the tests and docs that assert/describe that default.

## Components

| File | Change |
| --- | --- |
| `js/abilities/abilities.js` | Add shared helpers `requireBlock`, `collectBlocks`, `summarizeBlock`, `blockMatchesSearch`, `toSearchableText`, `attributeMatchesValue` (ported verbatim from contributor-day); register the 4 abilities below inside `registerEditorAbilities()`, each pushing its name onto the returned `abilityNames` array, same pattern as `editor/get-editor-tree` |
| `includes/LocalAbilities.php` | `get_enabled_ability_names()`'s default array grows from `['editor/get-editor-tree']` to the 5 names (tree + the 4 new ones) |
| `tests/wpunit/LocalAbilitiesWPUnitTest.php` | Update `test_get_enabled_ability_names_default` and `test_filter_local_abilities_script_module_data_adds_ability_names`, which currently assert the single-element array, to assert all 5 names |
| `docs/local-abilities.md` | Update the `nfd_editor_chat_local_ability_names` hook table row (default value) and the verification section to mention the new abilities |

No changes to `package.json`, `bootstrap.php`, `Application.php`, or any file under `src/` other
than the wpunit test.

### The four abilities (ported behavior)

**`editor/find-editor-blocks`** — `input_schema`: optional `search` (case-insensitive substring
match against block attribute values, HTML-markup-stripped), `name` (block name filter),
`attribute` (attribute-presence filter), `value` (exact attribute-value match, requires
`attribute`; objects/arrays compared as JSON), `clientId` (restrict the search to a subtree,
inclusive of that block; defaults to the whole document). A `value` given without `attribute` is
treated as `search`. `output_schema`: `{ blocks: [...], count }`, where each block is a flat
summary (`clientId`, `name`, `attributes`, `innerBlockCount`, `controlledInnerBlocks?`) — no
nested subtree, unlike `get-editor-tree`. Matched blocks are still descended into, so a match
nested inside a match is reported once each. Pattern (`ref`-controlled) loops are guarded the
same way `get-editor-tree` already guards them.

**`editor/get-block-location`** — `input_schema`: required `clientId`. Throws
(`requireBlock`) if the block doesn't exist — never returns a partial/null result for a bad ID.
`output_schema`: `{ clientId, name, rootClientId, index, parentClientIds, path }`, where `path`
is the ordered list of `{ clientId, name, index }` from the outermost parent down to the block
itself.

**`editor/get-editor-selection`** — no input. `output_schema`:
`{ selectedBlockClientId, selectedBlockClientIds, selectionStart, selectionEnd, selectedBlock }`.
`selectedBlock` is the full serialized subtree (via the existing `serializeBlock`) when a
selection exists and still resolves to a live block, `null` otherwise (the selection can
reference a block that was since removed).

**`editor/can-insert-block`** — `input_schema`: required `name`, optional `rootClientId`. If
`rootClientId` is given but does not resolve to a block, throws (`requireBlock`) rather than
silently checking against the document root. `output_schema`: `{ canInsert, name, rootClientId }`.

All four carry the same `meta.annotations` as `get-editor-tree` (`readonly: true, destructive:
false, idempotent: true`) and register under the existing `block-editor` ability category —
no new category.

## Data flow

Unchanged from Stage 1: PHP enqueues the script modules → `abilities.js` registers all 5
abilities (`get-editor-tree` + the 4 new ones) → `index.js` bridges the subset PHP enabled to
WebMCP → the chat's tool-list assembly picks them up via `document.modelContext.getTools()` →
`toolDispatcher.js` runs them locally, zero network cost, same as today for `get-editor-tree`.

## Error handling

Same convention already established: a local ability that fails throws a plain `Error` with an
actionable message, surfaced to the model as a tool error (never an uncaught exception, never a
silent fallback to a wrong-but-valid-looking result). Concretely: `get-block-location` and
`can-insert-block` both throw via `requireBlock` on an unknown `clientId`/`rootClientId`, rather
than returning `null` fields or checking against the document root as a fallback.

## Testing

- No parity check needed (per the approved design's Stage 2 rationale): these are pure reads
  with no existing `blockActions.js` counterpart to stay in sync with.
- Manual devtools verification, same pattern as Stage 1's Task 3 Step 5/6, repeated for each of
  the 4 abilities: confirm `await document.modelContext.getTools()` lists
  `editor_find-editor-blocks`, `editor_get-block-location`, `editor_get-editor-selection`,
  `editor_can-insert-block`, then spot-check one representative call per ability (e.g. find a
  paragraph block by text, locate it, check the selection after clicking it, check whether a
  `core/image` can be inserted at the root) and confirm the returned `structuredContent` matches
  what's actually in the editor.
- `tests/wpunit/LocalAbilitiesWPUnitTest.php` updated and passing (`composer run test -- --filter
  LocalAbilitiesWPUnitTest`) for the new 5-name default.
- `composer run lint` / `npm run lint:js` clean on the modified files.

## Rollout

All 4 abilities ship enabled by default (added directly to
`LocalAbilities::get_enabled_ability_names()`'s default array), same as `get-editor-tree` in
Stage 1 — per the approved design, pure additive reads carry the lowest risk in the rollout and
need no gating. `nfd_editor_chat_local_ability_names` remains available for a site to narrow the
list if needed. Nothing existing is removed or rewritten; this is purely additive, matching the
approved design's permanent-fallback principle.
