# Reusable Client-side Editor Abilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 21 reusable `blu-editor/*` client-side WordPress Abilities, expose them through an optional WebMCP bridge, and make Editor Chat prefer them for live Gutenberg operations.

**Architecture:** `wp-module-editor-chat` owns a native script-module library built on `@wordpress/abilities`; its callbacks operate directly on `wp.data` and do not depend on the chat. A separate WebMCP adapter exposes the public library to Editor Chat, while a webpack-side registry merges and dispatches those local tools through the refactored chat loop with explicit, safe fallbacks.

**Tech Stack:** PHP 7.3+, WordPress 7.0+ client-side Abilities API, native WordPress script modules, Gutenberg `wp.data`/`wp.blocks`, WebMCP, Jest via `@wordpress/scripts`, wp-browser/wpunit, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-reusable-client-editor-abilities-design.md`

## Global Constraints

- Public ability names use the exact `blu-editor/*` namespace and become stable contracts.
- Ability callbacks contain no Editor Chat UI, OpenAI, MCP client, progress, or dispatcher dependencies.
- Every supported operation executes inside its ability; successful results are never chat-only action descriptors.
- Typed fallback metadata is emitted only after confirming that no local mutation occurred.
- Loading requires WordPress 7.0+, a block-editor context, and `Permissions::is_editor()`; unsupported environments fail soft.
- Registration, enqueueing, WebMCP bridging, and consumer initialization are idempotent.
- Existing `blu-*` handlers and `/blu/mcp` behavior remain intact.
- User-facing copy remains brand-agnostic and uses the `nfd-editor-chat` text domain.

## Review Focus

- A stale `clientId`, sibling ID, or parent ID must fail before dispatch and must never fall back to the document root; Task 2 and Task 4 add explicit tests.
- Repeated enqueue/registration and late WebMCP registration must not duplicate abilities or tools; Task 1 and Task 7 add idempotency and race tests.
- A local write that partially mutates must never produce fallback metadata or run twice; Task 4, Task 5, and Task 8 add post-dispatch and fallback tests.
- Navigation entities, template parts, site logos, and controlled synced patterns must not be mutated through an unsafe generic path; Task 2, Task 5, and Task 6 add boundary tests.
- WordPress below 7.0, missing script modules, disabled filters, or insufficient users must preserve existing chat behavior; Task 1 and Task 8 add compatibility tests.

---

### Task 1: Public loader, registry, and WebMCP foundation

**Files:**
- Create: `includes/EditorAbilities.php`
- Create: `tests/wpunit/EditorAbilitiesWPUnitTest.php`
- Create: `js/abilities/constants.js`
- Create: `js/abilities/index.js`
- Create: `js/abilities/bootstrap.js`
- Create: `js/abilities/editor-store.js`
- Create: `js/abilities/block-tree-abilities.js`
- Create: `js/abilities/webmcp-env.js`
- Create: `js/abilities/webmcp-bridge.js`
- Create: `js/abilities/webmcp-bootstrap.js`
- Create: `js/abilities/test/registry.test.js`
- Create: `js/abilities/test/block-tree-abilities.test.js`
- Create: `js/abilities/test/webmcp-bridge.test.js`
- Create: `bin/vendor-webmcp-polyfill.sh`
- Create: `js/vendor/webmcp-polyfill/LICENSE`
- Create: `js/vendor/webmcp-polyfill/VERSION`
- Create: `js/vendor/webmcp-polyfill/webmcp-polyfill.js`
- Modify: `bootstrap.php`
- Modify: `includes/Application.php`
- Modify: `includes/ChatEditor.php`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `Permissions::is_editor()`, WordPress script-module functions, `@wordpress/abilities`.
- Produces: `EditorAbilities::enqueue( $with_webmcp = false ): bool`.
- Produces: `ABILITY_NAMES`, `READ_ONLY_ABILITY_NAMES`, and `WRITE_ABILITY_NAMES` from `js/abilities/constants.js`.
- Produces: `initializeEditorAbilities( { abilityNames } = {} ): Promise<string[]>`, `getRegisteredEditorAbilityNames(): string[]`, and `ready: Promise<string[]>` from the public module `@newfold-labs/editor-chat/editor-abilities`.
- Produces: `bridgeAbilitiesToWebMCP( abilityNames ): Promise<BridgeResult>`, `toToolName( abilityName ): string`, and `formatToolError( error ): WebMCPResult`.
- Produces: diagnostic `window.nfdEditorAbilities` containing the public
  `ready` promise, registered names, and optional WebMCP status.

- [ ] **Step 1: Add failing PHP loader tests**

  In `EditorAbilitiesWPUnitTest.php`, add tests named:

  ```php
  public function test_enqueue_rejects_users_without_editor_permission()
  public function test_enqueue_returns_false_below_wordpress_7()
  public function test_enqueue_returns_false_without_script_module_support()
  public function test_enqueue_registers_public_module_and_filtered_names()
  public function test_enqueue_is_idempotent()
  public function test_screen_filter_can_opt_in_a_block_editor_screen()
  public function test_webmcp_flag_enqueues_the_bridge_and_polyfill()
  ```

  Assert that failed gates enqueue no handles, the allow-list contains all 21
  `blu-editor/*` names, and two calls register/enqueue each handle once.

- [ ] **Step 2: Run the PHP test and verify it fails**

  Run: `composer run test -- --filter EditorAbilitiesWPUnitTest`

  Expected: FAIL because `EditorAbilities` does not exist.

- [ ] **Step 3: Add failing registry and bridge tests**

  In `registry.test.js`, mock `@wordpress/abilities` and assert:

  ```js
  await expect(initializeEditorAbilities()).resolves.toEqual([
  	"blu-editor/get-editor-tree",
  ]);
  await initializeEditorAbilities();
  expect(registerAbilityCategory).toHaveBeenCalledTimes(1);
  expect(registerAbility).toHaveBeenCalledTimes(1);
  expect(registerAbility.mock.calls[0][0].name).toBe("blu-editor/get-editor-tree");
  await expect(ready).resolves.toEqual(["blu-editor/get-editor-tree"]);
  ```

  In `webmcp-bridge.test.js`, assert:

  ```js
  expect(toToolName("blu-editor/get-editor-tree")).toBe("blu-editor_get-editor-tree");
  expect(formatToolError(new Error("Invalid input."))).toEqual({
  	content: [{ type: "text", text: "Invalid input." }],
  	isError: true,
  });
  ```

  Add an idempotency test proving two bridge calls register each owned tool once.

- [ ] **Step 4: Add JS test tooling and verify the tests fail**

  Add:

  ```json
  "test:unit": "wp-scripts test-unit-js --runInBand",
  "vendor": "bash bin/vendor-webmcp-polyfill.sh",
  "lint:js": "wp-scripts lint-js ./src ./js/abilities",
  "lint:js:fix": "wp-scripts lint-js ./src ./js/abilities --fix"
  ```

  Add `@mcp-b/webmcp-polyfill` as a dev dependency and regenerate
  `package-lock.json`.

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/registry.test.js js/abilities/test/block-tree-abilities.test.js js/abilities/test/webmcp-bridge.test.js`

  Expected: FAIL because the public modules do not exist.

- [ ] **Step 5: Implement the immutable public constants**

  Define the exact 21 `blu-editor/*` names, the 11 non-mutating names (ten reads
  plus `select-block`), and the ten write names. Freeze all exported arrays and
  assert in tests that the read/write sets are disjoint and cover
  `ABILITY_NAMES`.

- [ ] **Step 6: Implement the idempotent public registry**

  Register the `blu-editor` category and expose the interfaces above.
  `initializeEditorAbilities()` filters requested names against
  `ABILITY_NAMES`, invokes implemented family registration functions, and
  resolves `ready` only after registration finishes. Unknown or not-yet-
  implemented allow-list entries are ignored; the return value contains only
  successfully registered names.

- [ ] **Step 7: Implement the first end-to-end ability**

  Add lazy editor-store access, controlled-inner-block traversal, and
  `blu-editor/get-editor-tree` to prove the public registry, output schema, and
  adapter against one real callback. Test depth limiting, an empty editor, and
  a controlled-pattern recursion guard.

- [ ] **Step 8: Implement the generic WebMCP adapter**

  Convert WordPress input/output schemas and annotations without
  ability-specific branches. Execute through `executeAbility()`, preserve
  structured output, and attach typed fallback metadata only when present on an
  error. Track owned tool names so repeated initialization cannot duplicate or
  unregister another plugin's tools.

  Keep bridge startup in `webmcp-bootstrap.js`; `bootstrap.js` initializes only
  native WordPress abilities. This ensures
  `EditorAbilities::enqueue( false )` loads neither the adapter nor polyfill.

- [ ] **Step 9: Vendor the WebMCP polyfill**

  Make `bin/vendor-webmcp-polyfill.sh` copy the pinned standalone build, license,
  and version from `node_modules`. Run: `npm run vendor`.

  Expected: the three files under `js/vendor/webmcp-polyfill/` match the pinned
  dependency.

- [ ] **Step 10: Implement the PHP loader and application wiring**

  Define `NFD_EDITOR_CHAT_JS_URL` in `bootstrap.php`, initialize one
  `EditorAbilities` instance from `Application`, and register:

  - `@newfold-labs/editor-chat/editor-abilities`
  - `@newfold-labs/editor-chat/editor-abilities-bootstrap`
  - `@newfold-labs/editor-chat/webmcp-env`
  - `@newfold-labs/editor-chat/webmcp-bridge`
  - `@newfold-labs/editor-chat/webmcp-bootstrap`

  Pass the filtered name list through script-module data. Implement the three
  public filters from the spec with `( $default, $screen, $pagenow )` for the
  screen filter. Keep ChatEditor's existing private screen methods private:
  once either existing screen check succeeds,
  `ChatEditor::enqueue_site_editor_assets()` calls
  `EditorAbilities::enqueue( true )`. `EditorAbilities` separately hooks the
  block-editor enqueue lifecycle with a default-false screen-filter decision,
  allowing another plugin to opt in without duplicating ChatEditor's private
  screen rules.

- [ ] **Step 11: Run focused tests**

  Run: `composer run test -- --filter EditorAbilitiesWPUnitTest`

  Expected: PASS.

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/registry.test.js js/abilities/test/block-tree-abilities.test.js js/abilities/test/webmcp-bridge.test.js`

  Expected: PASS.

- [ ] **Step 12: Commit the foundation**

  ```bash
  git add bootstrap.php includes/Application.php includes/ChatEditor.php \
    includes/EditorAbilities.php \
    tests/wpunit/EditorAbilitiesWPUnitTest.php js/abilities js/vendor \
    bin/vendor-webmcp-polyfill.sh package.json package-lock.json
  git commit -m "feat: add reusable editor abilities foundation"
  ```

### Task 2: Complete block-tree and selection read abilities

**Files:**
- Modify: `js/abilities/editor-store.js`
- Modify: `js/abilities/block-tree-abilities.js`
- Modify: `js/abilities/test/block-tree-abilities.test.js`
- Modify: `js/abilities/index.js`

**Interfaces:**
- Consumes: family registrar contract `register( abilityDefinition ): boolean` from Task 1.
- Produces: `registerBlockTreeAbilities( register ): string[]`.
- Completes the family with `find-editor-blocks`, `get-block-location`,
  `get-editor-selection`, and `can-insert-block` alongside the existing
  `get-editor-tree`.
- Produces internal helpers `requireEditorStore()`, `requireBlock()`, `serializeBlock()`, and controlled-inner-block traversal for later tasks.

- [ ] **Step 1: Write failing read-ability tests**

  Mock `window.wp.data.select()` and assert:

  ```js
  await expect(execute("blu-editor/get-block-location", { clientId: "missing" }))
  	.rejects.toThrow('Unknown clientId "missing"');

  expect(await execute("blu-editor/find-editor-blocks", { search: "Chloe" })).toMatchObject({
  	count: 1,
  	blocks: [{ clientId: "paragraph-1", name: "core/paragraph" }],
  });

  expect(await execute("blu-editor/get-editor-selection")).toMatchObject({
  	selectedBlockClientId: "paragraph-1",
  });
  ```

  Add coverage for `maxDepth`, nested matches, a controlled synced pattern,
  recursive-pattern truncation, invalid `rootClientId`, and
  `canInsertBlockType`.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/block-tree-abilities.test.js`

  Expected: FAIL because the family is not registered.

- [ ] **Step 3: Implement shared editor-store helpers**

  Keep store access lazy so importing the public module outside an editor does
  not throw. `requireBlock()` must validate every supplied ID before any
  selector treats an empty value as the document root.

- [ ] **Step 4: Implement the remaining four read abilities**

  Complete the family by porting the corresponding behavior from
  `improve/wp-abilities`. Rename only the namespace and public module imports,
  and preserve controlled-inner-block loop protection and neutral output
  schemas.

- [ ] **Step 5: Register the family and run tests**

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/block-tree-abilities.test.js js/abilities/test/registry.test.js`

  Expected: PASS, and registry tests show exactly five implemented callbacks
  plus placeholder-free definitions for no other family.

- [ ] **Step 6: Commit block-tree reads**

  ```bash
  git add js/abilities/editor-store.js js/abilities/block-tree-abilities.js \
    js/abilities/test/block-tree-abilities.test.js js/abilities/index.js
  git commit -m "feat: add reusable editor tree abilities"
  ```

### Task 3: Block catalogue and pattern read abilities

**Files:**
- Create: `js/abilities/block-catalog-abilities.js`
- Create: `js/abilities/pattern-store.js`
- Create: `js/abilities/pattern-read-abilities.js`
- Create: `js/abilities/test/block-catalog-abilities.test.js`
- Create: `js/abilities/test/pattern-read-abilities.test.js`
- Modify: `js/abilities/index.js`

**Interfaces:**
- Consumes: editor-store helpers and family registrar from Tasks 1–2.
- Produces: `registerBlockCatalogAbilities( register ): string[]`.
- Produces: `registerPatternReadAbilities( register ): string[]`.
- Produces direct abilities `get-block-types`, `get-block-type`,
  `get-patterns`, `get-pattern`, and `get-pattern-categories`.
- Produces pattern loaders reused by Task 6.

- [ ] **Step 1: Write failing block-catalog tests**

  Assert search/category filtering, hidden-block handling, destination
  insertability, complete attribute schema, styles, variations, and a missing
  block type error:

  ```js
  expect(await execute("blu-editor/get-block-types", { search: "image" })).toMatchObject({
  	count: 1,
  	blockTypes: [{ name: "core/image" }],
  });
  await expect(execute("blu-editor/get-block-type", { name: "missing/type" }))
  	.rejects.toThrow("Unknown block type");
  ```

- [ ] **Step 2: Write failing pattern-read tests**

  Cover registered and user-created patterns, category normalization,
  destination filtering, synced references, markup inclusion, and unresolved
  pattern names.

- [ ] **Step 3: Run both tests and verify they fail**

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/block-catalog-abilities.test.js js/abilities/test/pattern-read-abilities.test.js`

  Expected: FAIL because the families do not exist.

- [ ] **Step 4: Implement block catalogue reads**

  Use the live `core/blocks` registry. Keep list output compact and return the
  full schema only from `get-block-type`.

- [ ] **Step 5: Implement shared pattern loading and read abilities**

  Combine registered patterns with `wp_block` records and
  `wp_pattern_category` terms. Preserve the historical names
  `core/block/<id>`, sync status, block counts, root block names, and optional
  parsed markup behavior.

- [ ] **Step 6: Run focused tests**

  Run the Step 3 command.

  Expected: PASS.

- [ ] **Step 7: Commit catalogue reads**

  ```bash
  git add js/abilities/block-catalog-abilities.js js/abilities/pattern-store.js \
    js/abilities/pattern-read-abilities.js js/abilities/test js/abilities/index.js
  git commit -m "feat: add block and pattern discovery abilities"
  ```

### Task 4: Structural block write abilities

**Files:**
- Create: `js/abilities/block-structure-abilities.js`
- Create: `js/abilities/test/block-structure-abilities.test.js`
- Modify: `js/abilities/editor-store.js`
- Modify: `js/abilities/index.js`

**Interfaces:**
- Consumes: block/editor helpers and `wp.blocks` from Tasks 2–3.
- Produces: `registerBlockStructureAbilities( register ): string[]`.
- Produces direct abilities `insert-block`, `move-block`, `remove-block`, and
  `transform-block`.
- Produces typed `EditorAbilityUnsupportedError` carrying optional
  `fallbackTool` and `fallbackArguments`, with `mutated === false`.

- [ ] **Step 1: Write failing structural-write tests**

  Cover nested insertion, sibling placement, root/post-content retargeting,
  invalid nesting, moving into self/descendant, locked remove/move, transforms
  producing one or many blocks, and stale IDs.

  Include:

  ```js
  await expect(execute("blu-editor/insert-block", {
  	name: "core/paragraph",
  	afterClientId: "stale",
  })).rejects.toThrow('Unknown afterClientId "stale"');
  expect(dispatch.insertBlocks).not.toHaveBeenCalled();
  ```

  Add a post-dispatch verification test where the mocked store refuses a move:
  the ability must throw and must not expose fallback metadata after dispatch.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/block-structure-abilities.test.js`

  Expected: FAIL because the structural abilities do not exist.

- [ ] **Step 3: Implement safe block construction and destination validation**

  Recursively validate names, attributes, inner blocks, parent/child nesting,
  sibling references, and destination roots before dispatch.

- [ ] **Step 4: Implement the four structural writes**

  Dispatch through `core/block-editor`, then query the resulting state and
  return actual IDs, roots, indexes, and changed status. Emit a typed fallback
  only for an allow-listed special entity detected before dispatch.

- [ ] **Step 5: Run focused tests**

  Run the Step 2 command.

  Expected: PASS.

- [ ] **Step 6: Commit structural writes**

  ```bash
  git add js/abilities/block-structure-abilities.js \
    js/abilities/test/block-structure-abilities.test.js \
    js/abilities/editor-store.js js/abilities/index.js
  git commit -m "feat: add structural editor abilities"
  ```

### Task 5: Self-contained content and attribute write abilities

**Files:**
- Create: `js/abilities/block-content-abilities.js`
- Create: `js/abilities/block-attribute-validation.js`
- Create: `js/abilities/test/block-content-abilities.test.js`
- Create: `js/abilities/test/block-attribute-validation.test.js`
- Modify: `js/abilities/index.js`

**Interfaces:**
- Consumes: editor-store helpers, block catalogue, and typed unsupported error.
- Produces: `registerBlockContentAbilities( register ): string[]`.
- Produces direct abilities `edit-block` and `update-block`.
- Produces `normalizeAttributes( blockName, patch ): Object` and
  `deepMergeAttributes( current, patch ): Object`.

- [ ] **Step 1: Write failing attribute-validation tests**

  Assert unknown keys, scalar type mismatches, nested query defaults, deep
  merge, explicit `null` clearing, conflicting color cleanup, and unchanged
  patches.

- [ ] **Step 2: Write failing direct-execution tests**

  Prove `edit-block` parses and replaces ordinary block markup itself:

  ```js
  const result = await execute("blu-editor/edit-block", {
  	clientId: "paragraph-1",
  	blockContent: "<!-- wp:paragraph --><p>Updated</p><!-- /wp:paragraph -->",
  });
  expect(dispatch.replaceBlock).toHaveBeenCalled();
  expect(result).toMatchObject({ changed: true, clientId: "paragraph-1" });
  expect(result.action).toBeUndefined();
  ```

  Prove `update-block` dispatches normalized attributes and verifies the
  resulting store. Add failures for unresolved image placeholders, image
  generation requests, site logo, navigation/template-part ancestry, edit
  locks, and a store that silently refuses the update.

- [ ] **Step 3: Run focused tests and verify they fail**

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/block-attribute-validation.test.js js/abilities/test/block-content-abilities.test.js`

  Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement attribute normalization**

  Validate against the registered block type, fill query-item defaults,
  deep-merge nested objects, remove `null` keys, and keep arrays atomic.

- [ ] **Step 5: Implement direct edit and update callbacks**

  `edit-block` accepts complete block markup for one replacement target and
  uses `wp.blocks.parse()` plus `replaceBlock()`. `update-block` applies the
  validated patch with `updateBlockAttributes()`. Both verify final state and
  return neutral mutation results.

  If image generation or a special entity is required, throw
  `EditorAbilityUnsupportedError` before mutation with the approved normalized
  fallback descriptor. Never return a successful `action`/`arguments`
  envelope.

- [ ] **Step 6: Run focused tests**

  Run the Step 3 command.

  Expected: PASS.

- [ ] **Step 7: Commit content writes**

  ```bash
  git add js/abilities/block-content-abilities.js \
    js/abilities/block-attribute-validation.js js/abilities/test \
    js/abilities/index.js
  git commit -m "feat: add direct block content abilities"
  ```

### Task 6: Pattern writes, selection, and history abilities

**Files:**
- Create: `js/abilities/pattern-write-abilities.js`
- Create: `js/abilities/editor-ui-abilities.js`
- Create: `js/abilities/test/pattern-write-abilities.test.js`
- Create: `js/abilities/test/editor-ui-abilities.test.js`
- Modify: `js/abilities/pattern-store.js`
- Modify: `js/abilities/index.js`

**Interfaces:**
- Consumes: pattern loaders, block construction, and editor-store helpers.
- Produces: `registerPatternWriteAbilities( register ): string[]`.
- Produces: `registerEditorUiAbilities( register ): string[]`.
- Produces direct abilities `insert-pattern`, `create-pattern`,
  `select-block`, `undo`, and `redo`.

- [ ] **Step 1: Write failing pattern-write tests**

  Cover registered, synced, and unsynced insertion; `asReference`; destination
  validation before dispatch; pattern creation from `clientIds` or supplied
  blocks; category creation; sync-status metadata; `replaceSource`; adjacent
  source validation; and current-user permission failure.

- [ ] **Step 2: Write failing selection/history tests**

  Assert stale selection IDs fail, selection does not count as a document
  mutation, unavailable undo/redo throws without dispatch, and successful
  history steps return `{ changed: true, direction }`.

- [ ] **Step 3: Run focused tests and verify they fail**

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test/pattern-write-abilities.test.js js/abilities/test/editor-ui-abilities.test.js`

  Expected: FAIL because the families do not exist.

- [ ] **Step 4: Implement pattern writes**

  Reuse normalized pattern data from Task 3. Validate all top-level blocks and
  all source IDs before the first write. Use the core data store for `wp_block`
  and category records, preserving the synced/unsynced semantics in the spec.

- [ ] **Step 5: Implement selection and history**

  Use `core/block-editor` for selection and `core/editor` history selectors and
  dispatchers. Keep `select-block` in the read-only/non-document-mutating set.

- [ ] **Step 6: Assert the complete public surface**

  Add a registry test:

  ```js
  expect(getRegisteredEditorAbilityNames()).toEqual(ABILITY_NAMES);
  expect(getRegisteredEditorAbilityNames()).toHaveLength(21);
  ```

  Assert every definition has label, description, category, input schema,
  output schema, callback, and accurate annotations.

- [ ] **Step 7: Run all native ability tests**

  Run: `npm run test:unit -- --runTestsByPath js/abilities/test`

  Expected: PASS with all 21 abilities registered.

- [ ] **Step 8: Commit the complete ability surface**

  ```bash
  git add js/abilities
  git commit -m "feat: add pattern and editor history abilities"
  ```

### Task 7: Webpack-side local tool registry

**Files:**
- Create: `src/services/localToolRegistry.js`
- Create: `src/services/test/localToolRegistry.test.js`

**Interfaces:**
- Consumes: WebMCP `document.modelContext` and `blu-editor_*` tools from Tasks 1–6.
- Produces: `isLocalToolName( name ): boolean`.
- Produces: `listLocalTools(): Promise<Tool[]>`.
- Produces: `runLocalTool( name, args ): Promise<LocalToolResult>`.
- Produces: `onLocalToolsChanged( callback ): (() => void) | null`.
- Produces: `mergeLocalAndMcpTools( localTools, mcpTools ): Tool[]`.
- Produces: `getLocalToolFallback( result ): FallbackDescriptor | null`.

- [ ] **Step 1: Write failing registry tests**

  Assert only `blu-editor_*` tools are consumed, stringified WebMCP schemas are
  parsed, structured output survives execution, missing contexts fail soft,
  tool-change subscriptions clean up, and duplicate direct MCP equivalents are
  removed without removing the three gateway tools.

  Add:

  ```js
  expect(isLocalToolName("blu-editor_get-editor-tree")).toBe(true);
  expect(isLocalToolName("blu-get-block-markup")).toBe(false);
  ```

  Test that an ordinary error and a fallback outside the explicit four-tool
  allow-list both return `null`.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm run test:unit -- --runTestsByPath src/services/test/localToolRegistry.test.js`

  Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement listing, execution, and subscriptions**

  Keep WebMCP as the only shared runtime surface between native modules and
  the webpack bundle. Normalize results to `{ isError, text,
  structuredContent }`.

- [ ] **Step 4: Implement safe deduplication and fallback parsing**

  Map:

  - `blu-editor_edit-block` → `blu-edit-block`
  - `blu-editor_move-block` → `blu-move-block`
  - `blu-editor_remove-block` → `blu-delete-block`
  - `blu-editor_update-block` → `blu-update-block-attrs`

  Do not accept success action descriptors. Accept typed fallback metadata only
  from an error result with object arguments and an allow-listed target.

- [ ] **Step 5: Run focused tests**

  Run the Step 2 command.

  Expected: PASS.

- [ ] **Step 6: Commit the consumer registry**

  ```bash
  git add src/services/localToolRegistry.js src/services/test/localToolRegistry.test.js
  git commit -m "feat: add local editor tool registry"
  ```

### Task 8: Editor Chat discovery and dispatch integration

**Files:**
- Create: `src/services/test/toolDispatcher.localAbilities.test.js`
- Create: `src/hooks/chat/test/constants.localAbilities.test.js`
- Modify: `src/hooks/chat/useSessionConfig.js`
- Modify: `src/hooks/chat/constants.js`
- Modify: `src/services/toolDispatcher.js`

**Interfaces:**
- Consumes: Task 7 registry and current focused handlers in
  `src/services/toolHandlers/`.
- Produces: model-facing local tool discovery independent of MCP health.
- Produces: dispatcher routing for `source: "local"` and
  `source: "local-fallback"`.
- Preserves: existing `executeToolCallsForREST( toolCalls, ctx )` result shape.

- [ ] **Step 1: Write failing constant-classification tests**

  Assert all 21 WebMCP names are in `EDITOR_TOOLS`, exactly the 11
  non-document-mutating names are in `READ_ONLY_TOOLS`, and every other local
  name is classified as a write.

- [ ] **Step 2: Write failing dispatcher tests**

  Cover:

  ```js
  expect(runLocalTool).toHaveBeenCalledWith("blu-editor_get-editor-tree", {});
  expect(mcpClient.callTool).not.toHaveBeenCalled();
  ```

  Add tests for a successful write setting `hasChanges`, pre-write snapshot,
  read calls avoiding snapshots, abort before execution, safe fallback through
  the matching existing handler, ordinary local error with no fallback, and
  no second execution after a successful local mutation.

- [ ] **Step 3: Run focused tests and verify they fail**

  Run: `npm run test:unit -- --runTestsByPath src/hooks/chat/test/constants.localAbilities.test.js src/services/test/toolDispatcher.localAbilities.test.js`

  Expected: FAIL because local names are not integrated.

- [ ] **Step 4: Integrate local and MCP discovery**

  In `useSessionConfig`, load local tools and MCP tools independently, retain
  the last MCP list in a ref, merge through Task 7, and subscribe to
  `toolchange`. An MCP connection failure must still publish local tools.

- [ ] **Step 5: Add explicit local classifications**

  Add the exact 21 `blu-editor_*` names to `EDITOR_TOOLS` and the exact 11
  non-document-mutating names to `READ_ONLY_TOOLS`. Export a focused
  `LOCAL_WRITE_TOOLS` set rather than treating every unknown local name as a
  write.

- [ ] **Step 6: Integrate local routing into the dispatcher**

  Partition local, `blu-*`, and other MCP calls. Capture the existing atomic
  snapshot before any `LOCAL_WRITE_TOOLS` call. Execute local calls through
  Task 7, carry `source`, `isError`, `hasChanges`, and structured fallback
  state into the existing result flow, and delegate only an approved fallback
  to the existing focused handler.

  Keep all current client and server branches behaviorally unchanged; do not
  apply the historical monolithic dispatcher diff.

- [ ] **Step 7: Run focused and regression JS tests**

  Run: `npm run test:unit`

  Expected: PASS.

- [ ] **Step 8: Commit Editor Chat integration**

  ```bash
  git add src/hooks/chat/useSessionConfig.js src/hooks/chat/constants.js \
    src/hooks/chat/test src/services/toolDispatcher.js src/services/test
  git commit -m "feat: use local abilities in editor chat"
  ```

### Task 9: Documentation, built assets, and end-to-end verification

**Files:**
- Create: `docs/editor-abilities.md`
- Modify: `docs/index.md`
- Modify: `docs/overview.md`
- Modify: `docs/development.md`
- Modify: `tests/playwright/specs/editor-chat.spec.js`
- Modify: `tests/playwright/helpers/mock-editor-chat-worker.js`
- Regenerate: `build/2.1.12/chat-editor.js`
- Regenerate: `build/2.1.12/chat-editor.asset.php`
- Regenerate if changed: `build/2.1.12/chat-editor.css`
- Regenerate if changed: `build/2.1.12/chat-editor-rtl.css`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: documented public loading, direct-execution, and WebMCP contracts.
- Produces: an E2E assertion that local execution bypasses `/blu/mcp`.

- [ ] **Step 1: Add a failing E2E scenario**

  Add a scenario that opens Editor Chat on WordPress 7.0+, waits for
  `window.nfdEditorAbilities.ready`, verifies
  `blu-editor_get-editor-tree` is listed, asks for a simple paragraph update,
  and asserts the page changes without a `/blu/mcp` request for the local
  operation.

  Add a second scenario with
  `nfd_editor_chat_editor_abilities_enabled` disabled and assert the existing
  MCP/handler path still completes.

- [ ] **Step 2: Run the E2E scenario and verify it fails**

  Run from the configured brand plugin as documented in
  `docs/development.md`.

  Expected: FAIL until built assets and test fixtures expose the local layer.

- [ ] **Step 3: Write the reusable integration guide**

  Document all 21 names, WordPress 7.0+ and permission requirements, the
  `EditorAbilities::enqueue()` signature, filters, direct
  `@wordpress/abilities` example, `ready` usage, optional WebMCP bridge,
  typed unsupported errors, and fallback behavior.

- [ ] **Step 4: Update documentation navigation and development workflow**

  Link `docs/editor-abilities.md` from `docs/index.md` and `docs/overview.md`.
  Document `npm run test:unit`, `npm run vendor`, and the WordPress 7.0+ E2E
  requirement in `docs/development.md`.

- [ ] **Step 5: Build production assets**

  Run: `npm run build`

  Expected: the checked-in `build/2.1.12` bundle contains the local registry
  integration and its asset manifest has the correct dependency/version hash.

- [ ] **Step 6: Run complete verification**

  Run:

  ```bash
  composer run lint
  composer run test
  npm run lint:js
  npm run test:unit
  npm run build
  ```

  Expected: every command exits 0.

  Run the two E2E scenarios from Steps 1–2.

  Expected: PASS.

- [ ] **Step 7: Commit docs and generated assets**

  ```bash
  git add docs tests/playwright build/2.1.12
  git commit -m "docs: document reusable editor abilities"
  ```

## Final verification

- [ ] Compare the 21 registered names against `ABILITY_NAMES` and the spec.
- [ ] Confirm a standalone test consumer can call an ability through
  `@wordpress/abilities` without importing Editor Chat code or WebMCP.
- [ ] Confirm no successful ability returns an `action` descriptor.
- [ ] Confirm local reads and ordinary writes produce no `/blu/mcp` request.
- [ ] Confirm disabled/unsupported local abilities preserve current behavior.
- [ ] Confirm special-entity fallbacks execute at most once and only before a
  local mutation.
- [ ] Confirm all focused, full-suite, lint, build, and E2E commands pass from
  fresh output.
