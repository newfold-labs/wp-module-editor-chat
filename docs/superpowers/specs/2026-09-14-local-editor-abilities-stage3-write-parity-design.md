# Design: local editor abilities — Stage 3, write parity (move/remove/update-block)

Status: proposed (not yet approved for implementation)
Date: 2026-09-14

## Problem

`docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md` (the approved design) lays
out an incremental rollout. Rollout Stage 1 (infrastructure + `editor/get-editor-tree`) and Stage
2 (the block-tree read family — `find-editor-blocks`, `get-block-location`, `get-editor-selection`,
`can-insert-block`) are implemented, reviewed, and merged. Live manual testing after Stage 2 also
surfaced and fixed two integration bugs pre-dating this work: `EDITOR_TOOLS` and `READ_ONLY_TOOLS`
in `src/hooks/chat/constants.js` are intent-based allow-lists that silently stripped every local
`editor/*` tool from the model's tool list for most intents; both now include the 5 read
abilities.

Rollout Stage 3 is the first write stage: "Add local abilities paralleling the writes
`blockActions.js` already covers... Once parity is verified, the dispatcher and tool-schema
assembly prefer the local one whenever it is registered; `blockActions.js` and its dispatch cases
stay in the codebase unchanged." This design covers exactly the three abilities that have a direct
legacy counterpart to parallel:

| New ability | Legacy counterpart | Tool name | Handler |
| --- | --- | --- | --- |
| `editor/move-block` | `blu-move-block` | `moveBlock.js` → `handleMoveAction` (`blockActions.js`) |
| `editor/remove-block` | `blu-delete-block` | `deleteBlock.js` → `handleDeleteAction` (`blockActions.js`) |
| `editor/update-block` | `blu-update-block-attrs` | `updateBlockAttrs.js` (dispatches directly, bypassing `blockActions.js`) |

The other 7 write abilities in the reference implementation (`insert-block`, `transform-block`,
`select-block`, `undo`, `redo`, `insert-pattern`, `create-pattern`) have no direct legacy
counterpart to parallel and are out of scope — separate, later plans.

## Goal

Port `editor/move-block`, `editor/remove-block`, and `editor/update-block` from
`contributor-day-editor-abilities/js/abilities.js`, faithfully, for the common case: a block that
is not part of a navigation menu, not part of a template part, and not (for `update-block`) the
site logo. Both the new local ability and its legacy `blu-*` counterpart stay registered and
visible to the model at all times — this design does not hide or supersede any legacy tool.

## Non-goals

- Not `editor/insert-block` or the other 7 reference write abilities — separate plans.
- Not replicating the legacy handlers' navigation-menu, template-part, or site-logo business
  logic (label-based nav item resolution, template-part entity path rewriting, column
  rebalancing, image-placeholder resolution, CSS-color-on-logo guards, etc.). A request touching
  one of those stays exclusively on the legacy/MCP path — see "Special-entity guard" below.
- Not full markup rewrites. `editor/update-block` only merges attributes (mirroring
  `blu-update-block-attrs`); full-content rewrite (`blu-edit-block` → `handleRewriteAction`) is
  untouched and has no local counterpart in this design.
- Not superseding any `blu-*` tool (`supersededMcpNames` in
  `src/services/localToolRegistry.js` stays empty, as it is today). The legacy handlers cover
  strictly more ground (special entities) than this design's local abilities, so hiding them
  would remove the only working path for those cases.
- Not a parity *test suite*. Per the existing project convention (no JS test runner; see the
  Stage 1/2 plans' Global Constraints), parity is verified manually via devtools, the same way
  every other local ability in this codebase has been.

## Architecture

Unchanged from Stage 1/2: the generic infrastructure (WebMCP bridge, bootstrap script,
`localToolRegistry.js`, `toolDispatcher.js`'s local-tool routing) is already ability-name-agnostic
and needs no changes. This design touches:

- `js/abilities/abilities.js` — the 3 new abilities, plus their shared dependencies (attribute
  validation helpers, a `getBlocksApi()` accessor for `window.wp.blocks`, and the new
  special-entity guard).
- `includes/LocalAbilities.php` — extend the default enabled-ability-names array with the 3 new
  names (8 total after this design).
- `tests/wpunit/LocalAbilitiesWPUnitTest.php` — update the 2 assertions on that default array.
- `src/hooks/chat/constants.js` — add the 3 new tool names to `EDITOR_TOOLS` (so
  `getToolsForIntent()` doesn't strip them for `edit_page`/`conversational` turns, the same fix
  already applied to the 5 read abilities). **Not** added to `READ_ONLY_TOOLS` — these abilities
  mutate the document.
- `docs/local-abilities.md` — hook table default value, verification section.

## Special-entity guard

Before any of the 3 abilities mutates anything, it calls a new shared helper,
`assertNotSpecialEntityBlock(store, clientId)`, added to `js/abilities/abilities.js` alongside the
existing helpers:

```js
function assertNotSpecialEntityBlock(store, clientId) {
	const block = store.getBlock(clientId);
	if (block?.name === "core/site-logo") {
		throw new Error(
			"core/site-logo is managed separately and is not supported by this ability yet."
		);
	}
	if (findAncestorRefNavigation(clientId)) {
		throw new Error(
			"This block is part of a navigation menu, which this ability does not support yet."
		);
	}
	if (findAncestorTemplatePart(clientId)) {
		throw new Error(
			"This block is part of a template part, which this ability does not support yet."
		);
	}
}
```

`findAncestorRefNavigation` (`src/services/navigationEditor.js`) and `findAncestorTemplatePart`
(`src/services/templatePartEditor.js`) already exist and are exactly what `blockActions.js` itself
uses to decide when to special-case a mutation — reused here as-is, not reimplemented.
`assertNotSpecialEntityBlock` is called with the block's own `clientId` at the very top of each
callback, right after `requireBlock`; `editor/move-block` additionally calls it a second time on
the destination `rootClientId` when one is given (a block cannot be moved from a normal parent
into a locked nav/template-part parent either). This throws — per the design's existing error
convention, a thrown local-ability error surfaces to the model as a tool error and never silently
falls back to MCP. The `blu-*` legacy tool remains in the model's tool list for exactly this case.

## Components

### `editor/move-block`

Faithful port of the reference implementation (identical `input_schema`/`output_schema`/callback
logic): `clientId` (required) plus one of `afterClientId`/`beforeClientId` (sibling-relative) or
`rootClientId`+`index` (absolute), guards against moving into itself or its own descendant,
verifies the move actually landed (a locked block is silently refused by the store) before
returning `{clientId, name, rootClientId, index, previousRootClientId, previousIndex}`. The guard
call added before this logic: `assertNotSpecialEntityBlock(store, input.clientId)`, and
`assertNotSpecialEntityBlock(store, input.rootClientId)` when `rootClientId` (or the sibling's
resolved root) is a real client ID.

### `editor/remove-block`

Faithful port: `clientId` (required), pre-checks `canRemoveBlock` before dispatching (unlike
`blockActions.js`'s `handleDeleteAction`, which dispatches then checks after — both end up
correctly refusing a locked block, this is a pre-existing difference in the reference
implementation, not something this design introduces), verifies removal, returns
`{clientId, name, rootClientId, index, removedInnerBlockCount}`. Guard call:
`assertNotSpecialEntityBlock(store, input.clientId)` before the `canRemoveBlock` check.

### `editor/update-block`

Faithful port: `clientId` + `attributes` (both required, `attributes` must be a non-empty plain
object). Requires porting 6 new shared helpers from the reference implementation, none of which
exist in `js/abilities/abilities.js` today: `getBlocksApi()` (accessor for `window.wp.blocks`,
mirroring the existing `getData()` pattern for `window.wp.data`), `isPlainObject`, `describeValue`,
`ATTRIBUTE_TYPE_CHECKS`/`matchesAttributeType`, `normalizeQueryItem`, `normalizeAttributeValue`,
`normalizeAttributes`. `normalizeAttributes(blockName, attributes)` validates every supplied key
exists on the block type's registered attribute schema (throwing with the full list of supported
keys otherwise) and that every value matches its declared `type`, filling in `query`-attribute
(e.g. table-cell) defaults that are normally only applied while parsing saved markup. This
validation does not exist in `blockActions.js`'s current approach (which validates serialized
*markup* strings via `validateBlockMarkup`, not attribute values against the block type schema) —
it is a strictly additional safety net, not a behavior removal. Guard call:
`assertNotSpecialEntityBlock(store, input.clientId)` before validating attributes.

## Data flow

Unchanged from Stage 1/2 for the common case: PHP enqueues the script modules → `abilities.js`
registers all 8 abilities (5 reads + 3 writes) → `index.js` bridges the PHP-enabled subset to
WebMCP → `useSessionConfig.js` merges local + MCP tools → `getToolsForIntent()` (now including the
3 new names in `EDITOR_TOOLS`) keeps them in the model's tool list for `edit_page`/`conversational`
→ `toolDispatcher.js` runs a local `editor_move-block`/`editor_remove-block`/`editor_update-block`
call with zero network cost, same as any other local ability today. For a special-entity block,
the ability throws before mutating anything; the `blu-*` equivalent (still present in the tool
list, per the no-supersession decision above) remains available for the model to use instead.

## Error handling

Same established convention: a local ability that fails throws a plain `Error` with an actionable
message, surfaced to the model as a tool error — never an uncaught exception, never a silent
no-op, never a silent fallback to MCP. This design adds one new category of throw (the
special-entity guard) on top of the reference implementation's existing throws (missing block,
invalid input shape, locked block, invalid nesting/attribute type).

## Testing

No JS test runner (established project convention). Manual devtools verification, per ability:

- **Common case (parity check against the legacy handler)**: on a plain paragraph/heading block
  not inside any navigation menu or template part, call the new ability and, separately, trigger
  the equivalent legacy tool call (via a chat prompt that reaches `blu-move-block`/
  `blu-delete-block`/`blu-update-block-attrs`, or by calling the legacy handler function directly
  from devtools if reachable) with an equivalent input, and confirm both produce the same
  resulting block tree (position for move, absence for remove, merged attributes for update) via
  `editor_get-editor-tree`/`editor_get-block-location`. This is the one-time gate the approved
  design's Testing section calls for before the dispatcher can be trusted to prefer the local path
  for the common case — it does not affect whether `blu-*` stays registered (it always does, per
  Non-goals).
- **Special-entity case**: attempt each of the 3 abilities against a block inside the site's
  navigation menu, a block inside a template part (e.g. header/footer), and (for `update-block`
  only) `core/site-logo`, and confirm each throws the expected guard error without mutating
  anything, and that the corresponding `blu-*` tool still works for that same block afterward.
- **Attribute validation (`update-block` only)**: confirm an unknown attribute key throws listing
  the block's real supported attributes, and a wrong-typed value (e.g. a string where the block
  declares `type: "boolean"`) throws with an actionable message.
- `tests/wpunit/LocalAbilitiesWPUnitTest.php` updated and passing (`composer run test -- --filter
  LocalAbilitiesWPUnitTest`) for the new 8-name default, same as every prior stage.
- `composer run lint` / `npx eslint js/abilities/abilities.js` clean.

## Rollout

All 3 abilities ship enabled by default in `LocalAbilities::get_enabled_ability_names()`'s default
array, same mechanism as every prior ability — "once parity is verified" (this plan's manual
testing step) is what gates adding them to that array, not a new runtime feature flag. Nothing
existing is removed, rewritten, or hidden: `blockActions.js`, every `toolHandlers/*.js` file, and
all `blu-*` tool registrations stay exactly as they are, and remain visible to the model
indefinitely for the special-entity cases this design explicitly does not cover.
