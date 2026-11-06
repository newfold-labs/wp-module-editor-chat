---
name: wp-module-editor-chat
title: Reusable Editor Abilities
description: Load and consume the public client-side Gutenberg abilities.
updated: 2026-11-06
---

# Reusable Editor Abilities

The module publishes 21 client-side abilities for reading and changing the live
Gutenberg editor. They use `@wordpress/abilities` and `wp.data` directly, so
they can see unsaved blocks, the current selection, registered block types,
patterns, and editor history.

The native abilities are independent of Editor Chat, its UI, and WebMCP.
Consumers may use them without loading or importing any chat code.

## Requirements and loading

The abilities require:

- WordPress 7.0 or newer and the WordPress script-module API;
- a block-editor screen;
- a user accepted by `Permissions::is_editor()`;
- the `nfd_editor_chat_editor_abilities_enabled` filter to remain enabled.

Unsupported environments fail soft: no abilities are registered and existing
Editor Chat handlers and MCP behavior remain available.

The public PHP loading API is:

```php
\NewfoldLabs\WP\Module\EditorChat\EditorAbilities::enqueue(
	bool $with_webmcp = false
): bool;
```

It is idempotent and returns `true` when the native layer was enqueued. Pass
`true` only when the WebMCP adapter is also needed. The method always applies
the version, script-module, block-editor, permission, and enabled gates.

The module normally loads the abilities on Editor Chat's supported editor
screens. Another plugin can opt in from a block-editor request:

```php
add_filter(
	'nfd_editor_chat_should_enqueue_editor_abilities',
	static function ( $default, $screen, $pagenow ) {
		return 'post.php' === $pagenow && $screen && $screen->is_block_editor();
	},
	10,
	3
);
```

### Public filters

- `nfd_editor_chat_editor_abilities_enabled( bool $enabled ): bool` — global
  kill switch; default `true`.
- `nfd_editor_chat_editor_ability_names( string[] $ability_names ): string[]`
  — allow-list of names to register; default is all 21 names. Unknown names are
  removed and contract order is preserved.
- `nfd_editor_chat_should_enqueue_editor_abilities(
bool $default, ?WP_Screen $screen, string $pagenow
): bool` — lets another plugin opt the current block-editor screen into the
  native layer; default `false`.

Filters do not bypass the requirements above.

## Public ability contract

Input uses camelCase. All callbacks resolve to neutral domain data; successful
results never contain an Editor Chat `action` descriptor.

### Block tree and selection reads

- `blu-editor/get-editor-tree` — input: optional `maxDepth`; output:
  hierarchical `blocks` and root `count`.
- `blu-editor/find-editor-blocks` — input: optional `search`, `name`,
  `attribute`, `value`, `rootClientId`, and `maxDepth`; output: matching
  `blocks` and `count`.
- `blu-editor/get-block-location` — input: `clientId`; output: block name,
  root, index, parent IDs, and path.
- `blu-editor/get-editor-selection` — no input; output: selected IDs, rich-text
  selection bounds, and selected block.
- `blu-editor/can-insert-block` — input: `name` and optional `rootClientId`;
  output: `canInsert`, name, and normalized root.

### Block catalogue and pattern reads

- `blu-editor/get-block-types` — input: optional `search`, `category`,
  `rootClientId`, `insertableOnly`, and `includeHidden`; output: compact
  `blockTypes`, match `count`, and `totalCount`.
- `blu-editor/get-block-type` — input: `name`; output: the live block
  definition, including attributes, supports, relationships, styles, and
  variations.
- `blu-editor/get-patterns` — input: optional `search`, `category`,
  `blockTypes`, `source`, `syncStatus`, `rootClientId`, and `includeHidden`;
  output: normalized `patterns`, match `count`, and `totalCount`.
- `blu-editor/get-pattern` — input: `name` plus optional `maxDepth` and
  `includeContent`; output: pattern metadata, parsed blocks, and block count,
  with markup when requested.
- `blu-editor/get-pattern-categories` — no input; output: normalized
  `categories` and `count`.

### Editor writes

- `blu-editor/edit-block` — input: `clientId`, complete `blockContent`, and
  optional image fields; replaces one ordinary block and returns the actual
  replacement IDs and attributes.
- `blu-editor/insert-block` — input: `name`, optional `attributes`,
  `innerBlocks`, `rootClientId`, `index`, and `afterClientId`; returns the
  inserted block ID and location.
- `blu-editor/move-block` — input: `clientId` plus a destination expressed by
  `rootClientId`/`index`, `afterClientId`, or `beforeClientId`; returns old and
  new locations and whether it changed.
- `blu-editor/remove-block` — input: `clientId`; returns the removed block's
  former location and descendant count.
- `blu-editor/update-block` — input: `clientId`, optional `attributes`, and
  optional image prompt; validates, deep-merges, dispatches, verifies, and
  returns the resulting attributes and changed keys.
- `blu-editor/transform-block` — input: `clientId`, destination block `name`,
  and optional `attributes` (validated, applied to the result in the same
  operation, for example `{ level: 6 }` for `core/heading`, which otherwise
  defaults to level 2); returns the resulting IDs, blocks, and indexes.
- `blu-editor/insert-pattern` — input: `name` plus optional `rootClientId`,
  `index`, `afterClientId`, and `asReference`; returns inserted IDs, pattern
  metadata, and location.
- `blu-editor/create-pattern` — input: `title`, either `clientIds` or `blocks`,
  and optional `syncStatus`, `categories`, and `replaceSource`; returns the
  saved pattern, categories, block count, and replacement metadata.

### UI and history

- `blu-editor/select-block` — input: `clientId`; selects a validated block and
  returns `changed: false` with current and previous selection details.
- `blu-editor/undo` — no input; returns `{ changed: true, direction: "undo" }`.
- `blu-editor/redo` — no input; returns `{ changed: true, direction: "redo" }`.

The ten read abilities plus `select-block` are non-document-mutating. The
remaining ten abilities are writes.

## Direct native consumption

Declare both the public module and `@wordpress/abilities` as dependencies of
the consumer's script module:

```php
wp_register_script_module(
	'acme/editor-inspector',
	plugins_url( 'editor-inspector.js', __FILE__ ),
	array(
		'@newfold-labs/editor-chat/editor-abilities',
		'@wordpress/abilities',
	),
	'1.0.0'
);
wp_enqueue_script_module( 'acme/editor-inspector' );
```

Then wait for registration and execute through the WordPress API:

```js
import { executeAbility, getAbility } from "@wordpress/abilities";
import { ready } from "@newfold-labs/editor-chat/editor-abilities";

await ready;

const ability = getAbility("blu-editor/get-editor-tree");
if (ability) {
	const result = await executeAbility("blu-editor/get-editor-tree", {
		maxDepth: 3,
	});
	console.log(result.blocks);
}
```

This consumer neither imports Editor Chat nor depends on WebMCP. The public
module also exports `ABILITY_NAMES`, `READ_ONLY_ABILITY_NAMES`,
`WRITE_ABILITY_NAMES`, `initializeEditorAbilities({ abilityNames })`, and
`getRegisteredEditorAbilityNames()`.

For diagnostics and non-module browser tests, the bootstrap exposes:

```js
const registeredNames = await window.nfdEditorAbilities.ready;
console.log(window.nfdEditorAbilities.registeredNames);
```

## Optional WebMCP bridge

Calling `EditorAbilities::enqueue(true)` additionally loads the bridge and the
vendored polyfill when native WebMCP is unavailable. After
`window.nfdEditorAbilities.ready`, the bridge publishes each slash name as a
WebMCP tool by replacing `/` with `_`; for example:

```text
blu-editor/get-editor-tree -> blu-editor_get-editor-tree
```

The bridge is idempotent, forwards schemas and annotations, executes through
`@wordpress/abilities`, preserves structured output, and only manages tools it
owns. Each tool is registered with an `AbortSignal`;
`window.nfdEditorAbilities.unbridge( abilityNames? )` unregisters the tools the
bridge registered (all of them by default) without touching other plugins'
tools. Direct native consumers do not need `document.modelContext`.

## Editor Chat routing

These rules apply to Editor Chat only. Direct native consumers always see all 21 abilities.

- **Content creation uses the server.** Editor Chat does not offer
  `blu-editor_insert-block` to the model. Adding a section with text and images
  goes through the server `blu-add-section` ability, which returns a formatted
  block. If the model calls the invented name `blu-editor_add-section`, the
  dispatcher runs `blu-add-section` instead. The hidden tool list is
  `MODEL_HIDDEN_LOCAL_TOOLS` in `src/services/localToolRegistry.js`; the alias map
  is `SERVER_OWNED_TOOL_ALIASES` in `src/services/toolDispatcher.js`.
- **Local results keep their error state.** WebMCP `executeTool` resolves with a
  JSON string. `runLocalTool` parses it so `isError` and `structuredContent`
  survive; a rejected write is reported to the model as an error.
- **Discovery does not use the read-only budget.** The no-progress guard stops a
  turn after `MAX_READ_ONLY_PASSES` consecutive read-only passes. Passes made only
  of `blu-list-abilities` or `blu-get-ability-schema` neither count nor reset the
  streak (`nextReadOnlyStreak` in `src/hooks/chat/conversationUtils.js`).

`blu-editor/edit-block` rebuilds the parsed tree with `createBlock()` when the
parser flags a block invalid, so models only need correct block comment
attributes and the saved HTML always matches `save()`.

Menu items: special entities (controlled navigation, template parts, site logo)
are detected before the generic lock check, so `edit-block` and `update-block`
return the typed fallback. When the fallback is `blu-edit-block` with a
`navigation-link` or `navigation-submenu` aimed at a `core/navigation` block,
the dispatcher runs `blu-insert-inner-block` with that block as the parent.

Insert-block validation accepts `rich-text` attributes as strings, so a nested
`core/heading` or `core/paragraph` with string `content` is valid for any
consumer that does call `blu-editor/insert-block`.

## Unsupported operations and fallback

Invalid input, stale IDs, locked blocks, refused dispatches, and ordinary
execution errors reject normally and are not retried through a legacy path.

Special entities (including controlled navigation, template parts, and site
logos) and image-aware operations may throw
`EditorAbilityUnsupportedError`. It has `mutated === false` and may include
`fallbackTool` and normalized `fallbackArguments`. A direct consumer receives
that typed error and decides what to do; it must not treat the metadata as a
successful result.

Only Editor Chat interprets fallback metadata. It accepts an explicit
allow-list of the existing edit, move, remove, and attribute-update handlers,
and invokes a fallback at most once. The local callback must identify the
unsupported case before dispatch and confirm that no mutation occurred.
Ordinary local reads and writes do not call `/blu/mcp`. If the native layer is
disabled, unavailable, or filtered out, the existing handler/MCP path remains
unchanged.
