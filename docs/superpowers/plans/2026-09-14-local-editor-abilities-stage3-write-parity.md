# Local Editor Abilities — Stage 3, Write-Parity Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three local (in-browser) editor abilities — `editor/move-block`,
`editor/remove-block`, `editor/update-block` — each paralleling an existing legacy write path
(`blu-move-block`, `blu-delete-block`, `blu-update-block-attrs`), per
`docs/superpowers/specs/2026-09-14-local-editor-abilities-stage3-write-parity-design.md`.

**Architecture:** Same generic infrastructure as Stage 1/2 (unchanged). This plan adds ability
registrations to `js/abilities/abilities.js`, extends the enabled-names default in
`includes/LocalAbilities.php`, and — new to this stage — adds the 3 tool names to `EDITOR_TOOLS`
in `src/hooks/chat/constants.js` (not `READ_ONLY_TOOLS`: these abilities mutate the document).
Before mutating anything, each ability calls a shared guard, `assertNotSpecialEntityBlock`, that
rejects navigation-menu blocks, template-part blocks, and `core/site-logo` — those stay
exclusively on the legacy/MCP path, which is never hidden or superseded.

**Tech Stack:** Hand-written ESM script module (`js/abilities/abilities.js`, no build step, ported
from `contributor-day-editor-abilities/js/abilities.js`), PHP 7.3+
(`NewfoldLabs\WP\Module\EditorChat` namespace, Codeception/wp-browser `wpunit` tests), the existing
webpack chat bundle (`src/hooks/chat/constants.js`, part of the ordinary `npm run build`).

## Global Constraints

- **Nothing existing is deleted, rewritten, or hidden.** `blockActions.js`, every
  `toolHandlers/*.js` file, and every `blu-*` tool stay exactly as they are and remain visible to
  the model at all times. `src/services/localToolRegistry.js`'s `supersededMcpNames` stays empty —
  this plan does not touch it.
- **No new JS test runner.** Same as Stage 1/2: JS is verified manually via devtools/lint, not an
  automated JS suite. PHP steps use the existing Codeception/wp-browser `wpunit` suite.
- **Faithful port for the common case.** Each ability's `input_schema`, `output_schema`, and
  callback logic match `contributor-day-editor-abilities/js/abilities.js` exactly, with one
  addition not in the reference: the `assertNotSpecialEntityBlock` guard call(s) documented in
  each task. Only code style (double quotes, tabs, compact parens) differs from the reference's
  own style.
- **`js/abilities/abilities.js` cannot import from `src/services/*`.** It is a hand-written script
  module loaded natively by the browser (`wp_register_script_module`); `src/` is a separate,
  webpack-bundled module graph with no shared import path. The special-entity guard in this plan
  reimplements the (simple, name-based) ancestor-walk logic self-contained — it does not import
  `findAncestorRefNavigation`/`findAncestorTemplatePart` from `src/services/navigationEditor.js`/
  `templatePartEditor.js`.
- Every new ability is added directly to `LocalAbilities::get_enabled_ability_names()`'s default
  array and to `EDITOR_TOOLS` in the same task that introduces it — "once parity is verified" (this
  plan's manual testing steps) is what gates that, not a new runtime feature flag.
- This plan covers exactly 3 write abilities (the ones with a direct legacy counterpart). The other
  7 reference write abilities (`insert-block`, `transform-block`, `select-block`, `undo`, `redo`,
  `insert-pattern`, `create-pattern`) are out of scope — separate, later plans.

---

## File Structure

| File | New/Modified | Responsibility |
| --- | --- | --- |
| `js/abilities/abilities.js` | Modified | Add the special-entity guard (Task 1), the attribute-validation helpers (Task 3), and the 3 new ability registrations |
| `includes/LocalAbilities.php` | Modified | `get_enabled_ability_names()`'s default array grows from 5 to 8 names, one at a time across Tasks 1-3 |
| `tests/wpunit/LocalAbilitiesWPUnitTest.php` | Modified | The 2 assertions on the default ability-names array updated to match, one at a time across Tasks 1-3 |
| `src/hooks/chat/constants.js` | Modified | `EDITOR_TOOLS` grows by one new tool name per task (Tasks 1-3); `READ_ONLY_TOOLS` is not touched by this plan |
| `docs/local-abilities.md` | Modified | Hook table default value and verification section, once all 3 abilities exist |

---

### Task 1: Special-entity guard + `editor/move-block`

**Files:**
- Modify: `js/abilities/abilities.js`
- Modify: `includes/LocalAbilities.php`
- Modify: `tests/wpunit/LocalAbilitiesWPUnitTest.php`
- Modify: `src/hooks/chat/constants.js`

**Interfaces:**
- Consumes: `getData`, `assertEditorReady`, `requireBlock`, `BLOCK_EDITOR_STORE`, `ensureAbility`
  (all already defined in `js/abilities/abilities.js` from Stage 1/2).
- Produces: helpers `isTemplatePartBlock(block)`, `isRefNavigationBlock(block)`,
  `findSpecialAncestorKind(store, clientId)`, `assertNotSpecialEntityBlock(store, clientId)` — all
  consumed by Tasks 2-3. Ability `editor/move-block`, WebMCP tool name `editor_move-block`.

- [ ] **Step 1: Add the special-entity guard helpers**

In `js/abilities/abilities.js`, immediately after the closing brace of `requireBlock()` (the
function ending `return block;\n}`) and before the `ensureAbilityCategory()` function, insert:

```js
/**
 * @param {Object} [block]
 * @return {boolean}
 */
function isTemplatePartBlock(block) {
	return block?.name === "core/template-part";
}

/**
 * A linked navigation block (core/navigation with a ref to a wp_navigation
 * entity) — mirrors src/services/navigationEditor.js's isRefNavigation(),
 * reimplemented here because that file is not reachable from this script
 * module (see this plan's Global Constraints).
 *
 * @param {Object} [block]
 * @return {boolean}
 */
function isRefNavigationBlock(block) {
	return block?.name === "core/navigation" && Boolean(block.attributes?.ref);
}

/**
 * @param {Object} store Block editor store selectors.
 * @param {string} clientId
 * @return {?string} "template part" or "navigation menu" if an ancestor is one, else null.
 */
function findSpecialAncestorKind(store, clientId) {
	let currentId = store.getBlockRootClientId(clientId);
	while (currentId) {
		const block = store.getBlock(currentId);
		if (isTemplatePartBlock(block)) {
			return "template part";
		}
		if (isRefNavigationBlock(block)) {
			return "navigation menu";
		}
		currentId = store.getBlockRootClientId(currentId);
	}
	return null;
}

/**
 * Reject a mutation on a block this design's write abilities don't yet
 * handle: the site logo, a navigation-menu block (or something inside
 * one), or a template-part block (or something inside one). The legacy
 * blu-* tool remains registered and available for these cases.
 *
 * @param {Object} store Block editor store selectors.
 * @param {string} clientId
 */
function assertNotSpecialEntityBlock(store, clientId) {
	const block = store.getBlock(clientId);
	if (block?.name === "core/site-logo") {
		throw new Error(
			"core/site-logo is managed separately and is not supported by this ability yet."
		);
	}
	if (isTemplatePartBlock(block)) {
		throw new Error("This block is a template part, which this ability does not support yet.");
	}
	if (isRefNavigationBlock(block)) {
		throw new Error("This block is a navigation menu, which this ability does not support yet.");
	}
	const ancestorKind = findSpecialAncestorKind(store, clientId);
	if (ancestorKind) {
		throw new Error(
			`This block is part of a ${ancestorKind}, which this ability does not support yet.`
		);
	}
}
```

- [ ] **Step 2: Register `editor/move-block`**

In `js/abilities/abilities.js`, inside `registerEditorAbilities()`, immediately after
`abilityNames.push("editor/can-insert-block");` and before `return abilityNames;`, insert:

```js
	ensureAbility({
		name: "editor/move-block",
		label: "Move Block",
		description: "Moves an existing block to a new position, optionally into a different parent.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				clientId: {
					type: "string",
					description: "Client ID of the block to move.",
				},
				afterClientId: {
					type: "string",
					description: "Move immediately after this block. Its parent becomes the destination parent.",
				},
				beforeClientId: {
					type: "string",
					description: "Move immediately before this block. Its parent becomes the destination parent.",
				},
				rootClientId: {
					type: "string",
					description: "Destination parent client ID. Omit to move within the document root.",
				},
				index: {
					type: "integer",
					description:
						"Destination index within the parent, counted after the move. Ignored when afterClientId or beforeClientId is set. Defaults to last.",
				},
			},
			required: ["clientId"],
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				clientId: { type: "string" },
				name: { type: "string" },
				rootClientId: { type: ["string", "null"] },
				index: { type: "integer" },
				previousRootClientId: { type: ["string", "null"] },
				previousIndex: { type: "integer" },
			},
			required: ["clientId", "name", "index"],
		},
		meta: {
			annotations: {
				readonly: false,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async (input = {}) => {
			assertEditorReady();
			const { select, dispatch } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const actions = dispatch(BLOCK_EDITOR_STORE);

			const block = requireBlock(store, input.clientId);
			assertNotSpecialEntityBlock(store, input.clientId);

			if (input.afterClientId && input.beforeClientId) {
				throw new Error("Provide only one of afterClientId or beforeClientId.");
			}
			if (input.index !== undefined && !Number.isInteger(input.index)) {
				throw new Error("index must be an integer.");
			}
			if (input.index !== undefined && input.index < 0) {
				throw new Error("index must be zero or greater.");
			}

			const fromRootClientId = store.getBlockRootClientId(input.clientId) || "";
			const fromIndex = store.getBlockIndex(input.clientId);

			const sibling = input.afterClientId || input.beforeClientId;
			let toRootClientId;
			let index;

			if (sibling) {
				const label = input.afterClientId ? "afterClientId" : "beforeClientId";
				if (sibling === input.clientId) {
					throw new Error(`${label} must be a different block than clientId.`);
				}
				requireBlock(store, sibling, label);

				toRootClientId = store.getBlockRootClientId(sibling) || "";
				if (input.rootClientId && input.rootClientId !== toRootClientId) {
					throw new Error(`${label} is not a child of the provided rootClientId.`);
				}

				const siblingIndex = store.getBlockIndex(sibling);
				index = input.afterClientId ? siblingIndex + 1 : siblingIndex;

				// Within one parent the block vacates its slot first, so
				// siblings below it shift up by one.
				if (toRootClientId === fromRootClientId && siblingIndex > fromIndex) {
					index -= 1;
				}
			} else {
				toRootClientId = input.rootClientId || "";
				if (toRootClientId) {
					requireBlock(store, toRootClientId, "rootClientId");
				}

				const order = store.getBlockOrder(toRootClientId) || [];
				const lastIndex = toRootClientId === fromRootClientId ? order.length - 1 : order.length;
				index = input.index === undefined ? lastIndex : Math.min(input.index, lastIndex);
			}

			if (toRootClientId) {
				assertNotSpecialEntityBlock(store, toRootClientId);
			}

			if (toRootClientId === input.clientId) {
				throw new Error("A block cannot be moved into itself.");
			}
			if (
				toRootClientId &&
				(store.getBlockParents(toRootClientId) || []).includes(input.clientId)
			) {
				throw new Error("A block cannot be moved into one of its own descendants.");
			}

			if (
				toRootClientId !== fromRootClientId &&
				!store.canInsertBlockType(block.name, toRootClientId || undefined)
			) {
				throw new Error(`Block "${block.name}" cannot be moved into the requested parent.`);
			}

			await actions.moveBlocksToPosition([input.clientId], fromRootClientId, toRootClientId, index);

			const newRootClientId = store.getBlockRootClientId(input.clientId) || "";
			const newIndex = store.getBlockIndex(input.clientId);

			// The store declines locked moves silently; report that as a failure.
			if (newRootClientId !== toRootClientId || newIndex !== index) {
				throw new Error("The editor did not move this block. It or its parent may be locked.");
			}

			return {
				clientId: input.clientId,
				name: block.name,
				rootClientId: newRootClientId || null,
				index: newIndex,
				previousRootClientId: fromRootClientId || null,
				previousIndex: fromIndex,
			};
		},
	});
	abilityNames.push("editor/move-block");
```

- [ ] **Step 3: Lint the file**

Run:
```bash
npx eslint js/abilities/abilities.js
```
Expected: no output (clean).

- [ ] **Step 4: Extend the PHP default ability-names list**

In `includes/LocalAbilities.php`, in `get_enabled_ability_names()`, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
			)
```

with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
			)
```

- [ ] **Step 5: Update the wpunit assertions**

In `tests/wpunit/LocalAbilitiesWPUnitTest.php`, in both `test_get_enabled_ability_names_default()`
and `test_filter_local_abilities_script_module_data_adds_ability_names()`, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
			),
```

(both occurrences) with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
			),
```

- [ ] **Step 6: Run the wpunit tests**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: PASS for all tests in `LocalAbilitiesWPUnitTest`.

- [ ] **Step 7: Lint PHP**

Run: `composer run lint`
Expected: no new errors.

- [ ] **Step 8: Add `editor_move-block` to `EDITOR_TOOLS`**

In `src/hooks/chat/constants.js`, in the `EDITOR_TOOLS` set, replace:

```js
	"editor_get-editor-tree",
	"editor_find-editor-blocks",
	"editor_get-block-location",
	"editor_get-editor-selection",
	"editor_can-insert-block",
]);
```

(the closing of `EDITOR_TOOLS`, not `READ_ONLY_TOOLS` — check you are editing the first `new Set([`
block in the file) with:

```js
	"editor_get-editor-tree",
	"editor_find-editor-blocks",
	"editor_get-block-location",
	"editor_get-editor-selection",
	"editor_can-insert-block",
	"editor_move-block",
]);
```

- [ ] **Step 9: Lint the constants file**

Run:
```bash
npx eslint src/hooks/chat/constants.js
```
Expected: no output (clean).

- [ ] **Step 10: Manual verification — the ability registers and works on a plain block**

Load a post editor screen with at least two sibling paragraph blocks. In DevTools:

```js
window.nfdEditorAbilities.abilityNames
// Expect: an array of 6 names ending in 'editor/move-block'

const tools = await document.modelContext.getTools();
tools.map((t) => t.name)
// Expect: an array including "editor_move-block"
```

Get two real client IDs first by calling the tree ability:

```js
const treeTool = tools.find((t) => t.name === 'editor_get-editor-tree');
JSON.parse(await document.modelContext.executeTool(treeTool, '{}')).structuredContent.blocks
// Note two sibling clientIds from this output as BLOCK_A / BLOCK_B below.
```

then:

```js
const tool = tools.find((t) => t.name === 'editor_move-block');
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'BLOCK_A', afterClientId: 'BLOCK_B' })));
// Expect: { content: [...], structuredContent: { clientId: 'BLOCK_A', name: '...', rootClientId: ..., index: ..., previousRootClientId: ..., previousIndex: ... } }
```

Confirm in the canvas that the block visually moved to the expected position.

- [ ] **Step 11: Manual verification — parity with the legacy handler**

In the chat, on a fresh conversation, ask it to move a plain paragraph block (a request that
reaches `blu-move-block` — e.g. temporarily disable the local ability via
`add_filter('nfd_editor_chat_local_ability_names', fn($n) => array_diff($n, ['editor/move-block']))`
in a must-use plugin, or simply compare the resulting position/attributes by eye) and confirm the
resulting block tree (via `editor_get-editor-tree`/`editor_get-block-location`) matches what
`editor_move-block` produced for an equivalent move in Step 10.

- [ ] **Step 12: Manual verification — special-entity guard**

On a site with a navigation menu block and a template-part-provided header/footer, attempt:

```js
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'NAV_LINK_CLIENT_ID', afterClientId: 'SOME_OTHER_ID' })));
// Expect: { content: [{ type: 'text', text: 'This block is a navigation menu, which this ability does not support yet.' }], isError: true }
```

(Substitute a client ID from inside the header/footer template part for the template-part case,
expecting `'This block is a template part, which this ability does not support yet.'`.) Confirm
nothing moved, and that asking the chat to move that same block still works via the legacy
`blu-move-block` path afterward.

- [ ] **Step 13: Commit**

```bash
git add js/abilities/abilities.js includes/LocalAbilities.php tests/wpunit/LocalAbilitiesWPUnitTest.php src/hooks/chat/constants.js
git commit -m "feat: add editor/move-block local ability with special-entity guard"
```

---

### Task 2: `editor/remove-block`

**Files:**
- Modify: `js/abilities/abilities.js`
- Modify: `includes/LocalAbilities.php`
- Modify: `tests/wpunit/LocalAbilitiesWPUnitTest.php`
- Modify: `src/hooks/chat/constants.js`

**Interfaces:**
- Consumes: `assertNotSpecialEntityBlock` (Task 1).
- Produces: ability `editor/remove-block`, WebMCP tool name `editor_remove-block`.

- [ ] **Step 1: Register `editor/remove-block`**

In `js/abilities/abilities.js`, inside `registerEditorAbilities()`, immediately after
`abilityNames.push("editor/move-block");` and before `return abilityNames;`, insert:

```js
	ensureAbility({
		name: "editor/remove-block",
		label: "Remove Block",
		description: "Removes a block, and everything nested inside it, from the editor.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				clientId: {
					type: "string",
					description: "Client ID of the block to remove.",
				},
			},
			required: ["clientId"],
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				clientId: { type: "string" },
				name: { type: "string" },
				rootClientId: { type: ["string", "null"] },
				index: { type: "integer" },
				removedInnerBlockCount: { type: "integer" },
			},
			required: ["clientId", "name", "index"],
		},
		meta: {
			annotations: {
				readonly: false,
				destructive: true,
				idempotent: true,
			},
		},
		callback: async (input = {}) => {
			assertEditorReady();
			const { select, dispatch } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const actions = dispatch(BLOCK_EDITOR_STORE);

			const block = requireBlock(store, input.clientId);
			assertNotSpecialEntityBlock(store, input.clientId);

			const rootClientId = store.getBlockRootClientId(input.clientId) || null;
			const index = store.getBlockIndex(input.clientId);

			if (store.canRemoveBlock?.(input.clientId) === false) {
				throw new Error(`Block "${block.name}" cannot be removed. It or its parent may be locked.`);
			}

			// Leave the selection alone: the agent is editing the document,
			// not moving a caret through it.
			await actions.removeBlock(input.clientId, false);

			if (store.getBlock(input.clientId)) {
				throw new Error("The editor did not remove this block. It or its parent may be locked.");
			}

			return {
				clientId: input.clientId,
				name: block.name,
				rootClientId,
				index,
				removedInnerBlockCount: (block.innerBlocks || []).length,
			};
		},
	});
	abilityNames.push("editor/remove-block");
```

- [ ] **Step 2: Lint the file**

Run:
```bash
npx eslint js/abilities/abilities.js
```
Expected: no output (clean).

- [ ] **Step 3: Extend the PHP default ability-names list**

In `includes/LocalAbilities.php`, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
			)
```

with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
			)
```

- [ ] **Step 4: Update the wpunit assertions**

In `tests/wpunit/LocalAbilitiesWPUnitTest.php`, in both places, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
			),
```

with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
			),
```

- [ ] **Step 5: Run the wpunit tests**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: PASS for all tests in `LocalAbilitiesWPUnitTest`.

- [ ] **Step 6: Lint PHP**

Run: `composer run lint`
Expected: no new errors.

- [ ] **Step 7: Add `editor_remove-block` to `EDITOR_TOOLS`**

In `src/hooks/chat/constants.js`, in `EDITOR_TOOLS`, replace:

```js
	"editor_can-insert-block",
	"editor_move-block",
]);
```

with:

```js
	"editor_can-insert-block",
	"editor_move-block",
	"editor_remove-block",
]);
```

- [ ] **Step 8: Lint the constants file**

Run: `npx eslint src/hooks/chat/constants.js`
Expected: no output (clean).

- [ ] **Step 9: Manual verification — the ability registers and works on a plain block**

On a post editor screen with a disposable paragraph block (e.g. add a throwaway one first):

```js
const tools = await document.modelContext.getTools();
const tool = tools.find((t) => t.name === 'editor_remove-block');
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'THROWAWAY_BLOCK_ID' })));
// Expect: { content: [...], structuredContent: { clientId: 'THROWAWAY_BLOCK_ID', name: 'core/paragraph', rootClientId: ..., index: ..., removedInnerBlockCount: 0 } }
```

Confirm the block is gone from the canvas and from `editor_get-editor-tree`'s output.

- [ ] **Step 10: Manual verification — parity with the legacy handler**

Ask the chat to delete a plain paragraph block (reaching `blu-delete-block`), and confirm the
resulting document (via `editor_get-editor-tree`) matches what a direct `editor_remove-block` call
on an equivalent block produced in Step 9 (block gone, siblings reindexed the same way).

- [ ] **Step 11: Manual verification — special-entity guard**

Attempt `editor_remove-block` against a block inside the site's navigation menu and against a
block inside a template part; confirm each throws
`"This block is a navigation menu, which this ability does not support yet."` /
`"This block is a template part, which this ability does not support yet."` (or the ancestor
variant, `"This block is part of a navigation menu..."` / `"...template part..."`, depending on
whether the target block itself or an ancestor is the special entity) without removing anything,
and that `blu-delete-block` still works for that block afterward.

- [ ] **Step 12: Commit**

```bash
git add js/abilities/abilities.js includes/LocalAbilities.php tests/wpunit/LocalAbilitiesWPUnitTest.php src/hooks/chat/constants.js
git commit -m "feat: add editor/remove-block local ability"
```

---

### Task 3: `editor/update-block` (+ attribute-validation helpers)

**Files:**
- Modify: `js/abilities/abilities.js`
- Modify: `includes/LocalAbilities.php`
- Modify: `tests/wpunit/LocalAbilitiesWPUnitTest.php`
- Modify: `src/hooks/chat/constants.js`

**Interfaces:**
- Consumes: `assertNotSpecialEntityBlock` (Task 1).
- Produces: helpers `getBlocksApi()`, `isPlainObject(value)`, `describeValue(value)`,
  `ATTRIBUTE_TYPE_CHECKS`, `matchesAttributeType(type, value)`,
  `normalizeQueryItem(item, query, path)`, `normalizeAttributeValue(value, schema, path)`,
  `normalizeAttributes(blockName, attributes)`. None are consumed by later tasks in this plan (this
  is the last ability task), but they are the porting foundation for `editor/insert-block` and
  `editor/create-pattern` in later, separate plans. Ability `editor/update-block`, WebMCP tool name
  `editor_update-block`.

- [ ] **Step 1: Add the attribute-validation helpers**

In `js/abilities/abilities.js`, immediately after the closing brace of
`assertNotSpecialEntityBlock()` (added in Task 1) and before `ensureAbilityCategory()`, insert:

```js
/**
 * @return {{ createBlock: Function, getBlockType: Function }}
 */
function getBlocksApi() {
	const { blocks } = window.wp || {};
	if (!blocks?.createBlock || !blocks?.getBlockType) {
		throw new Error("WordPress blocks API is not available.");
	}
	return blocks;
}

/**
 * @param {unknown} value
 * @return {boolean}
 */
function isPlainObject(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @return {string}
 */
function describeValue(value) {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "an array";
	}
	return `a ${typeof value}`;
}

const ATTRIBUTE_TYPE_CHECKS = {
	string: (value) => typeof value === "string",
	"rich-text": (value) => typeof value === "string",
	number: (value) => typeof value === "number",
	integer: (value) => Number.isInteger(value),
	boolean: (value) => typeof value === "boolean",
	array: (value) => Array.isArray(value),
	object: (value) => isPlainObject(value),
	null: (value) => value === null,
};

/**
 * @param {string|string[]} type
 * @param {unknown}         value
 * @return {boolean}
 */
function matchesAttributeType(type, value) {
	const types = Array.isArray(type) ? type : [type];
	return types.some((name) => {
		const check = ATTRIBUTE_TYPE_CHECKS[name];
		// An unfamiliar type keyword is not a reason to reject a value.
		return check ? check(value) : true;
	});
}

/**
 * Complete one item of a query-sourced attribute against its sub-schema.
 *
 * Defaults declared inside a `query` are only applied while parsing saved
 * markup, so attributes set programmatically arrive incomplete. A table cell
 * without its `tag` default renders as an undefined element and breaks the
 * block, so the defaults are filled in here.
 *
 * @param {unknown} item
 * @param {Object}  query Attribute sub-schema keyed by field.
 * @param {string}  path  Field path, used in error messages.
 * @return {Object}
 */
function normalizeQueryItem(item, query, path) {
	if (!isPlainObject(item)) {
		throw new Error(`${path} must be an object, received ${describeValue(item)}.`);
	}

	const unknown = Object.keys(item).filter((key) => !(key in query));
	if (unknown.length) {
		throw new Error(
			`${path} has no field(s): ${unknown.join(", ")}. Supported fields: ${Object.keys(query).join(", ")}.`
		);
	}

	const normalized = {};
	for (const [key, schema] of Object.entries(query)) {
		if (item[key] === undefined) {
			if (schema?.default !== undefined) {
				normalized[key] = schema.default;
			}
			continue;
		}
		normalized[key] = normalizeAttributeValue(item[key], schema, `${path}.${key}`);
	}
	return normalized;
}

/**
 * Validate one attribute value against its schema and complete nested rows.
 *
 * @param {unknown} value
 * @param {Object}  [schema]
 * @param {string}  path
 * @return {unknown}
 */
function normalizeAttributeValue(value, schema, path) {
	if (schema?.type && !matchesAttributeType(schema.type, value)) {
		const expected = Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type;
		throw new Error(`${path} must be of type ${expected}, received ${describeValue(value)}.`);
	}

	if (schema?.query && Array.isArray(value)) {
		return value.map((item, index) => normalizeQueryItem(item, schema.query, `${path}[${index}]`));
	}

	return value;
}

/**
 * Validate attribute keys and values against what the block type declares.
 *
 * @param {string} blockName
 * @param {Object} attributes
 * @return {Object}
 */
function normalizeAttributes(blockName, attributes) {
	const { getBlockType } = getBlocksApi();

	if (!isPlainObject(attributes)) {
		throw new Error("attributes must be an object.");
	}

	// Unknown keys are stored but never serialized, so fail loudly with the
	// list the block actually accepts.
	const supported = getBlockType(blockName)?.attributes;
	if (!supported) {
		return { ...attributes };
	}

	const keys = Object.keys(attributes);
	const unknown = keys.filter((key) => !(key in supported));
	if (unknown.length) {
		throw new Error(
			`Block "${blockName}" has no attribute(s): ${unknown.join(", ")}. Supported attributes: ${Object.keys(supported).join(", ")}.`
		);
	}

	const normalized = {};
	for (const key of keys) {
		normalized[key] = normalizeAttributeValue(attributes[key], supported[key], key);
	}
	return normalized;
}
```

- [ ] **Step 2: Register `editor/update-block`**

In `js/abilities/abilities.js`, inside `registerEditorAbilities()`, immediately after
`abilityNames.push("editor/remove-block");` and before `return abilityNames;`, insert:

```js
	ensureAbility({
		name: "editor/update-block",
		label: "Update Block",
		description:
			"Updates attributes on an existing block. Supplied attributes are merged into the current ones, and each value must match the shape the block type declares.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				clientId: {
					type: "string",
					description: "Client ID of the block to update.",
				},
				attributes: {
					type: "object",
					description: "Attributes to merge into the block. Omitted attributes keep their current values.",
				},
			},
			required: ["clientId", "attributes"],
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				clientId: { type: "string" },
				name: { type: "string" },
				attributes: { type: "object" },
				updatedAttributes: { type: "array" },
			},
			required: ["clientId", "name", "attributes"],
		},
		meta: {
			annotations: {
				readonly: false,
				destructive: true,
				idempotent: true,
			},
		},
		callback: async (input = {}) => {
			assertEditorReady();
			const { select, dispatch } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const actions = dispatch(BLOCK_EDITOR_STORE);

			const block = requireBlock(store, input.clientId);
			assertNotSpecialEntityBlock(store, input.clientId);

			if (!isPlainObject(input.attributes)) {
				throw new Error("attributes must be an object.");
			}

			const keys = Object.keys(input.attributes);
			if (!keys.length) {
				throw new Error("attributes must contain at least one key.");
			}

			const attributes = normalizeAttributes(block.name, input.attributes);

			await actions.updateBlockAttributes(input.clientId, attributes);

			const updated = requireBlock(store, input.clientId);
			return {
				clientId: input.clientId,
				name: updated.name,
				attributes: updated.attributes ?? {},
				updatedAttributes: keys,
			};
		},
	});
	abilityNames.push("editor/update-block");
```

- [ ] **Step 3: Lint the file**

Run:
```bash
npx eslint js/abilities/abilities.js
```
Expected: no output (clean).

- [ ] **Step 4: Extend the PHP default ability-names list**

In `includes/LocalAbilities.php`, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
			)
```

with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
				'editor/update-block',
			)
```

- [ ] **Step 5: Update the wpunit assertions**

In `tests/wpunit/LocalAbilitiesWPUnitTest.php`, in both places, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
			),
```

with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
				'editor/can-insert-block',
				'editor/move-block',
				'editor/remove-block',
				'editor/update-block',
			),
```

- [ ] **Step 6: Run the wpunit tests**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: PASS for all tests in `LocalAbilitiesWPUnitTest`.

- [ ] **Step 7: Lint PHP**

Run: `composer run lint`
Expected: no new errors.

- [ ] **Step 8: Add `editor_update-block` to `EDITOR_TOOLS`**

In `src/hooks/chat/constants.js`, in `EDITOR_TOOLS`, replace:

```js
	"editor_can-insert-block",
	"editor_move-block",
	"editor_remove-block",
]);
```

with:

```js
	"editor_can-insert-block",
	"editor_move-block",
	"editor_remove-block",
	"editor_update-block",
]);
```

- [ ] **Step 9: Lint the constants file**

Run: `npx eslint src/hooks/chat/constants.js`
Expected: no output (clean).

- [ ] **Step 10: Manual verification — the ability registers and works on a plain block**

```js
const tools = await document.modelContext.getTools();
const tool = tools.find((t) => t.name === 'editor_update-block');
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'A_PARAGRAPH_CLIENT_ID', attributes: { content: 'Updated by editor_update-block' } })));
// Expect: { content: [...], structuredContent: { clientId, name: 'core/paragraph', attributes: { content: 'Updated by editor_update-block', ... }, updatedAttributes: ['content'] } }
```

Confirm the canvas shows the new text.

- [ ] **Step 11: Manual verification — attribute validation**

```js
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'A_PARAGRAPH_CLIENT_ID', attributes: { notARealAttribute: 'x' } })));
// Expect: isError: true, text mentioning 'has no attribute(s): notARealAttribute' and listing core/paragraph's real supported attributes.

JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'A_PARAGRAPH_CLIENT_ID', attributes: { dropCap: 'not-a-boolean' } })));
// Expect: isError: true, text mentioning 'dropCap must be of type boolean, received a string.'
```

- [ ] **Step 12: Manual verification — parity with the legacy handler**

Ask the chat to change a plain attribute on a block (e.g. "make this heading bold" or a similar
request reaching `blu-update-block-attrs`), and confirm the resulting attributes (via
`editor_get-editor-tree`) match what an equivalent direct `editor_update-block` call produced in
Step 10 for the same kind of change.

- [ ] **Step 13: Manual verification — special-entity guard**

Attempt `editor_update-block` against `core/site-logo` (any attribute), a block inside the
navigation menu, and a block inside a template part; confirm each throws the expected guard error
(`"core/site-logo is managed separately..."` / the navigation-menu / template-part messages from
Task 1) without changing anything, and that the legacy `blu-update-block-attrs` (or
`blu/edit-logo` for the logo) still works afterward.

- [ ] **Step 14: Commit**

```bash
git add js/abilities/abilities.js includes/LocalAbilities.php tests/wpunit/LocalAbilitiesWPUnitTest.php src/hooks/chat/constants.js
git commit -m "feat: add editor/update-block local ability with attribute validation"
```

---

### Task 4: Documentation

**Files:**
- Modify: `docs/local-abilities.md`

**Interfaces:**
- Consumes: nothing new — describes the state produced by Tasks 1-3.
- Produces: nothing consumed by later tasks (this plan's last task).

- [ ] **Step 1: Update the hook table's default value**

In `docs/local-abilities.md`, replace:

```markdown
| `nfd_editor_chat_local_ability_names` | Filter, array, default `['editor/get-editor-tree', 'editor/find-editor-blocks', 'editor/get-block-location', 'editor/get-editor-selection', 'editor/can-insert-block']`. Narrows or extends which registered `editor/*` abilities are bridged to WebMCP (and therefore visible to the model) this request. |
```

with:

```markdown
| `nfd_editor_chat_local_ability_names` | Filter, array, default `['editor/get-editor-tree', 'editor/find-editor-blocks', 'editor/get-block-location', 'editor/get-editor-selection', 'editor/can-insert-block', 'editor/move-block', 'editor/remove-block', 'editor/update-block']`. Narrows or extends which registered `editor/*` abilities are bridged to WebMCP (and therefore visible to the model) this request. |
```

- [ ] **Step 2: Update the verification section**

In `docs/local-abilities.md`, replace:

```markdown
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
```

with:

```markdown
## Verification

1. Console on a post editor screen: `window.nfdEditorAbilities` lists the enabled ability names
   and reports whether WebMCP is supported.
2. `await document.modelContext.getTools()` includes `editor_get-editor-tree`,
   `editor_find-editor-blocks`, `editor_get-block-location`, `editor_get-editor-selection`,
   `editor_can-insert-block`, `editor_move-block`, `editor_remove-block`, and
   `editor_update-block`.
3. A chat prompt that only needs the open document, or asks for a plain move/delete/attribute
   change on an ordinary block (e.g. "how many blocks are in this post?", "move this block after
   the heading", "delete this paragraph", "make this heading bold"), resolves without a `/blu/mcp`
   request in the Network tab, and `[ToolExecutor:REST] Executed local ability editor_<name>
   (source: local)` appears in the console for the ability that ran.
4. The same kind of request against a block inside the site's navigation menu, inside a template
   part (header/footer), or against `core/site-logo`, still works — it goes through the legacy
   `blu-*` tool instead, since `editor_move-block`/`editor_remove-block`/`editor_update-block`
   reject those cases and neither hides nor replaces the legacy tool.
5. On a WordPress install without the client-side Abilities API (or with
   `nfd_editor_chat_local_abilities_enabled` filtered to `false`), the chat behaves exactly as
   it does today — confirms the fail-soft fallback.
```

- [ ] **Step 3: Commit**

```bash
git add docs/local-abilities.md
git commit -m "docs: document Stage 3 write-parity abilities"
```
