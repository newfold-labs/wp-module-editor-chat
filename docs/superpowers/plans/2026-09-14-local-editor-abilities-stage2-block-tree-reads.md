# Local Editor Abilities — Stage 2, Block-Tree Read Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four local (in-browser) editor abilities — `editor/find-editor-blocks`,
`editor/get-block-location`, `editor/get-editor-selection`, `editor/can-insert-block` — as a
faithful port from the reference implementation `contributor-day-editor-abilities`, per
`docs/superpowers/specs/2026-09-14-local-editor-abilities-stage2-block-tree-reads-design.md`.

**Architecture:** The local-abilities infrastructure (script-module bootstrap, WebMCP bridge,
`localToolRegistry.js`, `toolDispatcher.js`, `useSessionConfig.js`) was built generic over ability
names in Rollout Stage 1 and needs no changes. This plan only adds ability registrations to
`js/abilities/abilities.js` and extends the enabled-names default in `includes/LocalAbilities.php`.

**Tech Stack:** Hand-written ESM script module (`js/abilities/abilities.js`, no build step, ported
1:1 from `contributor-day-editor-abilities/js/abilities.js`), PHP 7.3+
(`NewfoldLabs\WP\Module\EditorChat` namespace, Codeception/wp-browser `wpunit` tests).

## Global Constraints

- **Nothing existing is deleted or rewritten.** `editor/get-editor-tree`, its helpers
  (`getData`, `assertEditorReady`, `getInnerBlocks`, `withControlledRef`, `serializeBlock`,
  `ensureAbilityCategory`, `ensureAbility`), and every abilities/PHP/dispatcher file from Stage 1
  stay exactly as they are. This plan only *adds* to `js/abilities/abilities.js` and
  `includes/LocalAbilities.php`.
- **No new JS test runner.** Same as Stage 1: this module has no Jest/`wp-scripts test-unit-js`
  setup, and neither does the reference implementation. JS abilities are verified manually via
  devtools, matching this module's and contributor-day's existing convention. PHP steps use the
  existing Codeception/wp-browser `wpunit` suite.
- **Faithful port, no behavior changes.** Each ability's `input_schema`, `output_schema`, and
  callback logic match `contributor-day-editor-abilities/js/abilities.js` exactly; only code
  style (double quotes, tab indentation, compact parens) is adapted to match this module's
  existing `js/abilities/abilities.js` conventions.
- This plan covers Rollout Stage 2's block-tree read family only. `editor/get-block-types`,
  `editor/get-block-type`, `editor/get-patterns`, `editor/get-pattern`, and
  `editor/get-pattern-categories` are separate, later plans. No write ability is in scope.
- Every new ability is added directly to `LocalAbilities::get_enabled_ability_names()`'s default
  array (enabled out of the box) — per the approved Stage 2 design, pure reads carry the lowest
  risk in the rollout and need no gating or parity check.

---

## File Structure

| File | New/Modified | Responsibility |
| --- | --- | --- |
| `js/abilities/abilities.js` | Modified | Add 6 shared helpers (`requireBlock`, `summarizeBlock`, `collectBlocks`, `attributeMatchesValue`, `toSearchableText`, `blockMatchesSearch`) and the 4 new ability registrations |
| `includes/LocalAbilities.php` | Modified | `get_enabled_ability_names()`'s default array grows from 1 to 5 names, one at a time across Tasks 1-4 |
| `tests/wpunit/LocalAbilitiesWPUnitTest.php` | Modified | The 2 assertions that check the default ability-names array are updated to match, one at a time across Tasks 1-4 |
| `docs/local-abilities.md` | Modified | Hook table default value and verification section, once all 4 abilities exist |

---

### Task 1: `editor/find-editor-blocks` (+ shared helpers)

**Files:**
- Modify: `js/abilities/abilities.js`
- Modify: `includes/LocalAbilities.php`
- Modify: `tests/wpunit/LocalAbilitiesWPUnitTest.php`

**Interfaces:**
- Consumes: `getData`, `assertEditorReady`, `getInnerBlocks`, `withControlledRef`,
  `ensureAbility` (all already defined in `js/abilities/abilities.js` from Stage 1).
- Produces: helpers `requireBlock(store, clientId, label?)`, `summarizeBlock(store, block)`,
  `collectBlocks(store, blocks, predicate, matches?, visitedRefs?)`,
  `attributeMatchesValue(attributeValue, expected)`, `toSearchableText(value)`,
  `blockMatchesSearch(block, search)` — all consumed by Tasks 2-4 (`requireBlock`) or reused
  as-is. Ability `editor/find-editor-blocks`, WebMCP tool name `editor_find-editor-blocks`.

- [ ] **Step 1: Update the file header comment**

In `js/abilities/abilities.js`, replace the header comment:

```js
/**
 * Local (in-browser) block editor abilities.
 *
 * These run in the browser against the live block editor stores and are
 * discoverable via @wordpress/abilities (and WebMCP via webmcp-bridge.js).
 *
 * This is Rollout Stage 1 (see docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md):
 * only editor/get-editor-tree exists so far. More abilities are added the
 * same way in later plans.
 */
```

with:

```js
/**
 * Local (in-browser) block editor abilities.
 *
 * These run in the browser against the live block editor stores and are
 * discoverable via @wordpress/abilities (and WebMCP via webmcp-bridge.js).
 *
 * This covers Rollout Stage 1 (editor/get-editor-tree) and Stage 2's
 * block-tree read family (editor/find-editor-blocks, editor/get-block-location,
 * editor/get-editor-selection, editor/can-insert-block) — see
 * docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md and
 * docs/superpowers/specs/2026-09-14-local-editor-abilities-stage2-block-tree-reads-design.md.
 * Block types and patterns are added the same way in later plans.
 */
```

- [ ] **Step 2: Add the shared helpers**

In `js/abilities/abilities.js`, immediately after the closing brace of `serializeBlock()` (the
function ending in `return node;\n}`) and before the `ensureAbilityCategory()` function, insert:

```js
/**
 * Describe a block without its nested subtree, for flat list results.
 *
 * @param {Object} store Block editor store selectors.
 * @param {Object} block
 * @return {Object} A flat block summary.
 */
function summarizeBlock(store, block) {
	const { innerBlocks, controlled } = getInnerBlocks(store, block);
	const summary = {
		clientId: block.clientId,
		name: block.name,
		attributes: block.attributes ?? {},
		innerBlockCount: innerBlocks.length,
	};
	if (controlled) {
		summary.controlledInnerBlocks = true;
	}
	return summary;
}

/**
 * Walk the block tree and collect matches as flat summaries. Matched blocks
 * are still descended into, so a match nested inside a match is reported
 * once each.
 *
 * @param {Object}                     store         Block editor store selectors.
 * @param {Object[]}                   blocks
 * @param {(block: Object) => boolean} predicate
 * @param {Object[]}                   [matches]
 * @param {Set<any>}                   [visitedRefs] Pattern entities on the current path.
 * @return {Object[]} Flat summaries of matching blocks.
 */
function collectBlocks(store, blocks, predicate, matches = [], visitedRefs = new Set()) {
	for (const block of blocks) {
		if (predicate(block)) {
			matches.push(summarizeBlock(store, block));
		}

		const { innerBlocks, controlled } = getInnerBlocks(store, block);
		if (!innerBlocks.length) {
			continue;
		}

		const childRefs = controlled ? withControlledRef(block, visitedRefs) : visitedRefs;
		if (childRefs === null) {
			continue;
		}

		collectBlocks(store, innerBlocks, predicate, matches, childRefs);
	}
	return matches;
}

/**
 * Compare an attribute against the requested value as a string. Objects and
 * arrays are compared as JSON so equivalent structures still match.
 *
 * @param {*}      attributeValue
 * @param {string} expected
 * @return {boolean}
 */
function attributeMatchesValue(attributeValue, expected) {
	if (attributeValue === null || attributeValue === undefined) {
		return false;
	}
	if (typeof attributeValue === "object") {
		return JSON.stringify(attributeValue) === expected;
	}
	return String(attributeValue) === expected;
}

/**
 * Reduce a rich-text attribute to searchable text so a phrase typed by a
 * person can match markup like "<strong>Chloe Nolan</strong>" or
 * "Founder &amp; CEO".
 *
 * @param {string} value
 * @return {string}
 */
function toSearchableText(value) {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")
		.toLowerCase();
}

/**
 * Case-insensitive substring match against every string attribute of a block.
 *
 * @param {Object} block
 * @param {string} search
 * @return {boolean}
 */
function blockMatchesSearch(block, search) {
	const needle = search.toLowerCase();
	return Object.values(block.attributes || {}).some((value) => {
		if (typeof value !== "string") {
			return false;
		}
		return value.toLowerCase().includes(needle) || toSearchableText(value).includes(needle);
	});
}

/**
 * Resolve a client ID to a block, throwing when it is missing or unknown.
 *
 * @param {Object} store    Block editor store selectors.
 * @param {string} clientId
 * @param {string} [label]  Input field name, used in the error message.
 * @return {Object} The resolved block.
 */
function requireBlock(store, clientId, label = "clientId") {
	const block = clientId ? store.getBlock(clientId) : null;
	if (!block) {
		throw new Error(`Block not found for ${label}: ${clientId}`);
	}
	return block;
}
```

- [ ] **Step 3: Register `editor/find-editor-blocks`**

In `js/abilities/abilities.js`, inside `registerEditorAbilities()`, immediately after
`abilityNames.push("editor/get-editor-tree");` and before `return abilityNames;`, insert:

```js
	ensureAbility({
		name: "editor/find-editor-blocks",
		label: "Find Editor Blocks",
		description: "Finds blocks in the editor by visible text, block name, and/or attribute value.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				search: {
					type: "string",
					description:
						"Text to look for in the block attributes, matched case-insensitively as a substring and ignoring HTML markup. Use this to find a block by the words shown in the editor.",
				},
				name: {
					type: "string",
					description: "Block name to match (e.g. core/paragraph). Omit to match any name.",
				},
				attribute: {
					type: "string",
					description:
						"Attribute key that must be present on the block. Omit value to match on presence alone.",
				},
				value: {
					type: "string",
					description:
						"Exact attribute value to match, requires attribute. Compared as a string; objects and arrays are compared as JSON. Without attribute it is treated as search.",
				},
				clientId: {
					type: "string",
					description:
						"Optional client ID to search within, including the block itself. Defaults to the full document.",
				},
			},
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				blocks: {
					type: "array",
					description: "Flat list of matching blocks, without their nested subtrees.",
				},
				count: { type: "integer" },
			},
			required: ["blocks", "count"],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async (input = {}) => {
			assertEditorReady();
			const { select } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const roots = input.clientId ? [requireBlock(store, input.clientId)] : store.getBlocks();

			// A value without an attribute is a text search, never "no filter".
			const search = input.search ?? (input.attribute ? undefined : input.value);

			const matches = collectBlocks(store, roots, (block) => {
				if (input.name && block.name !== input.name) {
					return false;
				}
				if (input.attribute) {
					const attributes = block.attributes || {};
					if (!(input.attribute in attributes)) {
						return false;
					}
					if (
						input.value !== undefined &&
						!attributeMatchesValue(attributes[input.attribute], input.value)
					) {
						return false;
					}
				}
				if (search && !blockMatchesSearch(block, search)) {
					return false;
				}
				return true;
			});

			return { blocks: matches, count: matches.length };
		},
	});
	abilityNames.push("editor/find-editor-blocks");
```

- [ ] **Step 4: Lint the file**

Run:
```bash
npx eslint js/abilities/abilities.js
```
Expected: no output (clean).

- [ ] **Step 5: Extend the PHP default ability-names list**

In `includes/LocalAbilities.php`, in `get_enabled_ability_names()`, replace:

```php
		return (array) \apply_filters(
			'nfd_editor_chat_local_ability_names',
			array( 'editor/get-editor-tree' )
		);
```

with:

```php
		return (array) \apply_filters(
			'nfd_editor_chat_local_ability_names',
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
			)
		);
```

- [ ] **Step 6: Update the wpunit assertions**

In `tests/wpunit/LocalAbilitiesWPUnitTest.php`, in `test_get_enabled_ability_names_default()`,
replace:

```php
		$this->assertSame( array( 'editor/get-editor-tree' ), LocalAbilities::get_enabled_ability_names() );
```

with:

```php
		$this->assertSame(
			array( 'editor/get-editor-tree', 'editor/find-editor-blocks' ),
			LocalAbilities::get_enabled_ability_names()
		);
```

And in `test_filter_local_abilities_script_module_data_adds_ability_names()`, replace:

```php
		$this->assertSame( array( 'editor/get-editor-tree' ), $result['abilityNames'] );
```

with:

```php
		$this->assertSame(
			array( 'editor/get-editor-tree', 'editor/find-editor-blocks' ),
			$result['abilityNames']
		);
```

- [ ] **Step 7: Run the wpunit tests**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: PASS for all tests in `LocalAbilitiesWPUnitTest`.

- [ ] **Step 8: Lint PHP**

Run: `composer run lint`
Expected: no new errors from `includes/LocalAbilities.php`.

- [ ] **Step 9: Manual verification — the ability registers and works**

Load a post editor screen (`post-new.php`) with at least one paragraph block containing some
text (e.g. "Hello world"). In DevTools:

```js
window.nfdEditorAbilities.abilityNames
// Expect: ['editor/get-editor-tree', 'editor/find-editor-blocks']

const tools = await document.modelContext.getTools();
tools.map((t) => t.name)
// Expect: an array including "editor_find-editor-blocks"

const tool = tools.find((t) => t.name === 'editor_find-editor-blocks');
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ search: 'hello' })));
// Expect: { content: [...], structuredContent: { blocks: [{ name: 'core/paragraph', ... }], count: 1 } }
```

Also confirm an unmatched search returns an empty result without throwing:

```js
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ search: 'no-such-text-xyz' })));
// Expect: structuredContent: { blocks: [], count: 0 }
```

- [ ] **Step 10: Commit**

```bash
git add js/abilities/abilities.js includes/LocalAbilities.php tests/wpunit/LocalAbilitiesWPUnitTest.php
git commit -m "feat: add editor/find-editor-blocks local ability"
```

---

### Task 2: `editor/get-block-location`

**Files:**
- Modify: `js/abilities/abilities.js`
- Modify: `includes/LocalAbilities.php`
- Modify: `tests/wpunit/LocalAbilitiesWPUnitTest.php`

**Interfaces:**
- Consumes: `requireBlock` (Task 1).
- Produces: ability `editor/get-block-location`, WebMCP tool name `editor_get-block-location`.

- [ ] **Step 1: Register `editor/get-block-location`**

In `js/abilities/abilities.js`, inside `registerEditorAbilities()`, immediately after
`abilityNames.push("editor/find-editor-blocks");` and before `return abilityNames;`, insert:

```js
	ensureAbility({
		name: "editor/get-block-location",
		label: "Get Block Location",
		description: "Returns the hierarchical location of a block (parents, root, and index).",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				clientId: {
					type: "string",
					description: "Client ID of the block to locate.",
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
				parentClientIds: { type: "array" },
				path: { type: "array" },
			},
			required: ["clientId", "index", "parentClientIds", "path"],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async ({ clientId } = {}) => {
			assertEditorReady();
			const { select } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const block = requireBlock(store, clientId);

			const parentClientIds = store.getBlockParents(clientId) || [];
			const rootClientId = store.getBlockRootClientId(clientId);
			const index = store.getBlockIndex(clientId);

			const path = [...parentClientIds, clientId].map((id) => {
				const node = store.getBlock(id);
				return {
					clientId: id,
					name: node?.name ?? null,
					index: store.getBlockIndex(id),
				};
			});

			return {
				clientId,
				name: block.name,
				rootClientId: rootClientId || null,
				index,
				parentClientIds,
				path,
			};
		},
	});
	abilityNames.push("editor/get-block-location");
```

- [ ] **Step 2: Lint the file**

Run:
```bash
npx eslint js/abilities/abilities.js
```
Expected: no output (clean).

- [ ] **Step 3: Extend the PHP default ability-names list**

In `includes/LocalAbilities.php`, in `get_enabled_ability_names()`, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
			)
```

with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
			)
```

- [ ] **Step 4: Update the wpunit assertions**

In `tests/wpunit/LocalAbilitiesWPUnitTest.php`, in both `test_get_enabled_ability_names_default()`
and `test_filter_local_abilities_script_module_data_adds_ability_names()`, replace:

```php
		array( 'editor/get-editor-tree', 'editor/find-editor-blocks' ),
```

(both occurrences) with:

```php
		array( 'editor/get-editor-tree', 'editor/find-editor-blocks', 'editor/get-block-location' ),
```

- [ ] **Step 5: Run the wpunit tests**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: PASS for all tests in `LocalAbilitiesWPUnitTest`.

- [ ] **Step 6: Lint PHP**

Run: `composer run lint`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

On the same editor screen, find a block's `clientId` from `editor/get-editor-tree`'s output
(or from Step 9 of Task 1), then:

```js
const tools = await document.modelContext.getTools();
const tool = tools.find((t) => t.name === 'editor_get-block-location');
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'PASTE_A_REAL_CLIENT_ID' })));
// Expect: { content: [...], structuredContent: { clientId, name, rootClientId, index, parentClientIds: [...], path: [...] } }
```

Confirm an unknown `clientId` surfaces a tool error, not a thrown exception or a null result:

```js
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ clientId: 'not-a-real-id' })));
// Expect: { content: [{ type: 'text', text: 'Block not found for clientId: not-a-real-id' }], isError: true }
```

- [ ] **Step 8: Commit**

```bash
git add js/abilities/abilities.js includes/LocalAbilities.php tests/wpunit/LocalAbilitiesWPUnitTest.php
git commit -m "feat: add editor/get-block-location local ability"
```

---

### Task 3: `editor/get-editor-selection`

**Files:**
- Modify: `js/abilities/abilities.js`
- Modify: `includes/LocalAbilities.php`
- Modify: `tests/wpunit/LocalAbilitiesWPUnitTest.php`

**Interfaces:**
- Consumes: `serializeBlock` (Stage 1, unmodified).
- Produces: ability `editor/get-editor-selection`, WebMCP tool name `editor_get-editor-selection`.

- [ ] **Step 1: Register `editor/get-editor-selection`**

In `js/abilities/abilities.js`, inside `registerEditorAbilities()`, immediately after
`abilityNames.push("editor/get-block-location");` and before `return abilityNames;`, insert:

```js
	ensureAbility({
		name: "editor/get-editor-selection",
		label: "Get Editor Selection",
		description: "Returns the current block and rich-text selection in the editor.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				selectedBlockClientId: { type: ["string", "null"] },
				selectedBlockClientIds: { type: "array" },
				selectionStart: { type: ["object", "null"] },
				selectionEnd: { type: ["object", "null"] },
				selectedBlock: { type: ["object", "null"] },
			},
			required: ["selectedBlockClientId", "selectedBlockClientIds", "selectionStart", "selectionEnd"],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async () => {
			assertEditorReady();
			const { select } = getData();
			const store = select(BLOCK_EDITOR_STORE);
			const selectedBlockClientId = store.getSelectedBlockClientId() || null;
			const selectedBlockClientIds = store.getSelectedBlockClientIds() || [];
			const selectionStart = store.getSelectionStart() || null;
			const selectionEnd = store.getSelectionEnd() || null;
			// The selection can reference a block that is already gone.
			const selectedBlock = selectedBlockClientId ? store.getBlock(selectedBlockClientId) : null;

			return {
				selectedBlockClientId,
				selectedBlockClientIds,
				selectionStart,
				selectionEnd,
				selectedBlock: selectedBlock ? serializeBlock(store, selectedBlock) : null,
			};
		},
	});
	abilityNames.push("editor/get-editor-selection");
```

- [ ] **Step 2: Lint the file**

Run:
```bash
npx eslint js/abilities/abilities.js
```
Expected: no output (clean).

- [ ] **Step 3: Extend the PHP default ability-names list**

In `includes/LocalAbilities.php`, in `get_enabled_ability_names()`, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
			)
```

with:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
			)
```

- [ ] **Step 4: Update the wpunit assertions**

In `tests/wpunit/LocalAbilitiesWPUnitTest.php`, in both places, replace:

```php
		array( 'editor/get-editor-tree', 'editor/find-editor-blocks', 'editor/get-block-location' ),
```

with:

```php
		array(
			'editor/get-editor-tree',
			'editor/find-editor-blocks',
			'editor/get-block-location',
			'editor/get-editor-selection',
		),
```

- [ ] **Step 5: Run the wpunit tests**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: PASS for all tests in `LocalAbilitiesWPUnitTest`.

- [ ] **Step 6: Lint PHP**

Run: `composer run lint`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

On the editor screen, click into a block in the canvas to select it, then in DevTools:

```js
const tools = await document.modelContext.getTools();
const tool = tools.find((t) => t.name === 'editor_get-editor-selection');
JSON.parse(await document.modelContext.executeTool(tool, '{}'));
// Expect: structuredContent.selectedBlockClientId matches the block you clicked, and
// structuredContent.selectedBlock.name is that block's name.
```

Click into empty space to deselect, run it again, and confirm
`selectedBlockClientId: null, selectedBlock: null`.

- [ ] **Step 8: Commit**

```bash
git add js/abilities/abilities.js includes/LocalAbilities.php tests/wpunit/LocalAbilitiesWPUnitTest.php
git commit -m "feat: add editor/get-editor-selection local ability"
```

---

### Task 4: `editor/can-insert-block`

**Files:**
- Modify: `js/abilities/abilities.js`
- Modify: `includes/LocalAbilities.php`
- Modify: `tests/wpunit/LocalAbilitiesWPUnitTest.php`

**Interfaces:**
- Consumes: `requireBlock` (Task 1).
- Produces: ability `editor/can-insert-block`, WebMCP tool name `editor_can-insert-block`.

- [ ] **Step 1: Register `editor/can-insert-block`**

In `js/abilities/abilities.js`, inside `registerEditorAbilities()`, immediately after
`abilityNames.push("editor/get-editor-selection");` and before `return abilityNames;`, insert:

```js
	ensureAbility({
		name: "editor/can-insert-block",
		label: "Can Insert Block",
		description: "Checks whether a block type can be inserted at a given location in the editor.",
		category: "block-editor",
		input_schema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Block name to check (e.g. core/image).",
				},
				rootClientId: {
					type: "string",
					description: "Optional parent client ID. Omit to check at the document root.",
				},
			},
			required: ["name"],
			additionalProperties: false,
		},
		output_schema: {
			type: "object",
			properties: {
				canInsert: { type: "boolean" },
				name: { type: "string" },
				rootClientId: { type: ["string", "null"] },
			},
			required: ["canInsert", "name"],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async ({ name, rootClientId } = {}) => {
			assertEditorReady();
			const { select } = getData();
			const store = select(BLOCK_EDITOR_STORE);

			if (rootClientId) {
				requireBlock(store, rootClientId, "rootClientId");
			}

			const canInsert = store.canInsertBlockType(name, rootClientId || undefined);
			return {
				canInsert: !!canInsert,
				name,
				rootClientId: rootClientId || null,
			};
		},
	});
	abilityNames.push("editor/can-insert-block");
```

- [ ] **Step 2: Lint the file**

Run:
```bash
npx eslint js/abilities/abilities.js
```
Expected: no output (clean).

- [ ] **Step 3: Extend the PHP default ability-names list**

In `includes/LocalAbilities.php`, in `get_enabled_ability_names()`, replace:

```php
			array(
				'editor/get-editor-tree',
				'editor/find-editor-blocks',
				'editor/get-block-location',
				'editor/get-editor-selection',
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
		),
```

- [ ] **Step 5: Run the wpunit tests**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: PASS for all tests in `LocalAbilitiesWPUnitTest`.

- [ ] **Step 6: Lint PHP**

Run: `composer run lint`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

On the editor screen, in DevTools:

```js
const tools = await document.modelContext.getTools();
const tool = tools.find((t) => t.name === 'editor_can-insert-block');
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ name: 'core/paragraph' })));
// Expect: structuredContent: { canInsert: true, name: 'core/paragraph', rootClientId: null }
```

Confirm an unknown `rootClientId` surfaces a tool error rather than silently checking the
document root:

```js
JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ name: 'core/paragraph', rootClientId: 'not-a-real-id' })));
// Expect: { content: [{ type: 'text', text: 'Block not found for rootClientId: not-a-real-id' }], isError: true }
```

- [ ] **Step 8: Commit**

```bash
git add js/abilities/abilities.js includes/LocalAbilities.php tests/wpunit/LocalAbilitiesWPUnitTest.php
git commit -m "feat: add editor/can-insert-block local ability"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/local-abilities.md`

**Interfaces:**
- Consumes: nothing new — describes the state produced by Tasks 1-4.
- Produces: nothing consumed by later tasks (this plan's last task).

- [ ] **Step 1: Update the hook table's default value**

In `docs/local-abilities.md`, replace:

```markdown
| `nfd_editor_chat_local_ability_names` | Filter, array, default `['editor/get-editor-tree']`. Narrows or extends which registered `editor/*` abilities are bridged to WebMCP (and therefore visible to the model) this request. |
```

with:

```markdown
| `nfd_editor_chat_local_ability_names` | Filter, array, default `['editor/get-editor-tree', 'editor/find-editor-blocks', 'editor/get-block-location', 'editor/get-editor-selection', 'editor/can-insert-block']`. Narrows or extends which registered `editor/*` abilities are bridged to WebMCP (and therefore visible to the model) this request. |
```

- [ ] **Step 2: Update the verification section**

In `docs/local-abilities.md`, replace the verification list:

```markdown
## Verification

1. Console on a post editor screen: `window.nfdEditorAbilities` lists the enabled ability names
   and reports whether WebMCP is supported.
2. `await document.modelContext.getTools()` includes `editor_get-editor-tree`.
3. A chat prompt that only needs the block tree (e.g. "how many blocks are in this post?")
   resolves without a `/blu/mcp` request in the Network tab, and
   `[ToolExecutor:REST] Executed local ability editor_get-editor-tree (source: local)` appears
   in the console.
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

- [ ] **Step 3: Commit**

```bash
git add docs/local-abilities.md
git commit -m "docs: document Stage 2 block-tree read abilities"
```
