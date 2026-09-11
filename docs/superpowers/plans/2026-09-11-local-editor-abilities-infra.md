# Local Editor Abilities — Infrastructure + First Ability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the local (in-browser) editor-abilities layer described in
`docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md`, end to end, for exactly
one ability (`editor/get-editor-tree`) — proving the whole architecture works before more
abilities are added in follow-up plans.

**Architecture:** A new script-module layer (`js/abilities/`, enqueued by a new PHP class
`LocalAbilities`) registers WordPress client-side abilities and bridges them to WebMCP
(`document.modelContext`), completely decoupled from the existing webpack chat bundle. The
existing chat bundle gains a small new module, `src/services/localToolRegistry.js`, that reads
`document.modelContext` at runtime to find and call those abilities with zero network cost.
`toolDispatcher.js` tries this local path first; everything that isn't found there falls through
to the existing `blockActions.js` / MCP path, completely unchanged.

**Tech Stack:** PHP 7.3+ (`NewfoldLabs\WP\Module\EditorChat` namespace, Codeception/wp-browser
`wpunit` tests), hand-written ESM script modules (no build step, WordPress 7.0+ Abilities API),
existing webpack/`@wordpress/scripts` chat bundle (no new build tooling).

## Global Constraints

- This module (`wp-module-editor-chat`) is a Composer *library*, composed into brand plugins —
  it has no `plugin_dir_url()` of its own. Asset URLs are built from
  `$container->plugin()->url . 'vendor/newfold-labs/wp-module-editor-chat/...'`
  (see `bootstrap.php` and `NFD_EDITOR_CHAT_ASSETS_URL`), never `plugin_dir_url( __FILE__ )`.
- The client-side Abilities API (`@wordpress/abilities` script module) requires
  **WordPress 7.0+**. Every piece of this layer must fail soft (register zero local tools,
  leave the rest of the module working exactly as today) when it is unavailable — this is not
  optional, see the spec's "Open technical risk" section.
- **Nothing existing is deleted or rewritten.** `blockActions.js`, the MCP (`/blu/mcp`) path, and
  every current tool handler in `toolDispatcher.js` stay exactly as they are. This plan only
  *adds* a parallel, faster path.
- **No new JS test runner.** This module has no Jest/`wp-scripts test-unit-js` setup today (only
  lint/format), and neither does the reference implementation
  (`contributor-day-editor-abilities`) this design is modeled on. Per the approved spec's
  Testing section, JS steps in this plan are verified manually via devtools, matching this
  module's and contributor-day's existing convention — **not** a TDD gap, a deliberate,
  spec-approved choice. PHP steps *do* use this module's existing Codeception/wp-browser
  `wpunit` suite, which is a real, already-working test harness (see `tests/wpunit/`).
- Local WebMCP tool names are prefixed `editor_` (already decided in the spec) — this is how
  code tells a local ability apart from a `blu-*` one, everywhere a tool name appears.
- This plan covers Rollout Stage 1 (spec) only: infrastructure plus one read ability. Every
  other ability in the spec's rollout is a separate, later plan.

---

## File Structure

| File | New/Modified | Responsibility |
| --- | --- | --- |
| `package.json` | Modified | Add `@mcp-b/webmcp-polyfill` devDependency + `vendor` script |
| `.gitignore` | Modified | Un-ignore `js/vendor/` (the bare `vendor` rule currently matches it) |
| `bin/vendor-webmcp-polyfill.sh` | New | Copies the polyfill's IIFE build into `js/vendor/webmcp-polyfill/` |
| `js/vendor/webmcp-polyfill/*` | New (generated, committed) | Vendored polyfill, installs `document.modelContext` when the browser has none |
| `bootstrap.php` | Modified | Define `NFD_EDITOR_CHAT_JS_URL` alongside the existing constants |
| `includes/LocalAbilities.php` | New | Enqueues the local-abilities script modules; owns the two new hooks |
| `includes/Application.php` | Modified | Instantiate `LocalAbilities` alongside `ChatEditor` |
| `tests/wpunit/LocalAbilitiesWPUnitTest.php` | New | WPUnit tests for `LocalAbilities`, same style as `ChatEditorWPUnitTest.php` |
| `js/abilities/webmcp-polyfill.js` | New | Env probe: `getModelContext()` / `getWebMCPStatus()` (ported from contributor-day, log prefix changed) |
| `js/abilities/abilities.js` | New | `registerEditorAbilities()` — block-tree helpers + the `editor/get-editor-tree` ability |
| `js/abilities/webmcp-bridge.js` | New | Bridges registered abilities to `document.modelContext.registerTool` |
| `js/abilities/index.js` | New | Bootstrap entry; reads the allowed-ability-names config, registers, bridges, sets `window.nfdEditorAbilities` |
| `src/services/localToolRegistry.js` | New | Webpack-world consumer: `listLocalTools()`, `isLocalToolName()`, `runLocalTool()`, `mergeLocalAndMcpTools()` |
| `src/services/toolDispatcher.js` | Modified | New local-tool bucket + execution loop in `executeToolCallsForREST()` |
| `src/hooks/chat/useSessionConfig.js` | Modified | Merge local tools into the OpenAI tool list |
| `docs/local-abilities.md` | New | Architecture, hooks, verification steps |
| `docs/index.md` | Modified | Add the new doc to the table of contents |
| `docs/overview.md` | Modified | One bullet noting local execution |

---

### Task 1: Vendor the WebMCP polyfill

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `bin/vendor-webmcp-polyfill.sh`
- Create (generated): `js/vendor/webmcp-polyfill/webmcp-polyfill.js`, `js/vendor/webmcp-polyfill/LICENSE`, `js/vendor/webmcp-polyfill/VERSION`

**Interfaces:**
- Produces: a classic script at `js/vendor/webmcp-polyfill/webmcp-polyfill.js` that installs
  `document.modelContext` on load when the browser has no native WebMCP support. Task 2 enqueues
  it as the `nfd-editor-chat-webmcp-polyfill` handle.

- [ ] **Step 1: Add the devDependency and `vendor` script to `package.json`**

In `package.json`, add to `"devDependencies"` (keep alphabetical, matching the existing list):

```json
		"@mcp-b/webmcp-polyfill": "^4.0.0",
```

And add to `"scripts"`:

```json
		"vendor": "bash bin/vendor-webmcp-polyfill.sh",
```

- [ ] **Step 2: Fix `.gitignore` so the vendored polyfill isn't swallowed by the bare `vendor` rule**

The existing `.gitignore` has a bare `vendor` line (for Composer's `vendor/`), which also matches
`js/vendor/` anywhere in the tree. Add these two lines directly after the existing `vendor` line:

```gitignore
!/js/vendor/
!/js/vendor/**
```

- [ ] **Step 3: Create `bin/vendor-webmcp-polyfill.sh`**

```bash
#!/usr/bin/env bash
#
# Copy the standalone build of @mcp-b/webmcp-polyfill into js/vendor.
#
# The IIFE build is the one that can ship without a bundler: the ESM build
# imports @cfworker/json-schema as a bare specifier, which nothing would
# resolve, while this build inlines it and initializes itself on load.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="${ROOT}/node_modules/@mcp-b/webmcp-polyfill"
TARGET="${ROOT}/js/vendor/webmcp-polyfill"

if [ ! -d "${PACKAGE}/dist" ]; then
	echo "Missing ${PACKAGE}/dist. Run 'npm install' first." >&2
	exit 1
fi

VERSION="$(node -p "require('${PACKAGE}/package.json').version")"

rm -rf "${TARGET}"
mkdir -p "${TARGET}"
cp "${PACKAGE}/dist/index.iife.js" "${TARGET}/webmcp-polyfill.js"
cp "${PACKAGE}/LICENSE" "${TARGET}/LICENSE"

# The source map is not shipped; drop the reference so DevTools does not 404.
node -e "
	const fs = require('fs');
	const path = process.argv[1];
	const source = fs.readFileSync(path, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, '').trimEnd();
	fs.writeFileSync(path, source + '\n');
" "${TARGET}/webmcp-polyfill.js"

cat > "${TARGET}/VERSION" <<EOF
@mcp-b/webmcp-polyfill ${VERSION} (dist/index.iife.js)
Vendored by bin/vendor-webmcp-polyfill.sh — do not edit by hand.
EOF

echo "Vendored @mcp-b/webmcp-polyfill ${VERSION} into js/vendor/webmcp-polyfill"
```

- [ ] **Step 4: Make it executable, install, and run it**

Run:
```bash
chmod +x bin/vendor-webmcp-polyfill.sh
npm install
npm run vendor
```
Expected: `Vendored @mcp-b/webmcp-polyfill 4.x.x into js/vendor/webmcp-polyfill`, and the three
files listed above now exist.

- [ ] **Step 5: Verify `.gitignore` fix worked**

Run:
```bash
git check-ignore -v js/vendor/webmcp-polyfill/webmcp-polyfill.js || echo "NOT IGNORED (expected)"
```
Expected: `NOT IGNORED (expected)` — if `git check-ignore` instead prints a matching rule, the
negation in Step 2 is not working (check the negated directory pattern needs to appear before
any narrower re-ignoring pattern; there is none here, so this should not happen).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore bin/vendor-webmcp-polyfill.sh js/vendor/webmcp-polyfill
git commit -m "build: vendor @mcp-b/webmcp-polyfill for local editor abilities"
```

---

### Task 2: PHP — `LocalAbilities` class, wiring, and hooks

**Files:**
- Modify: `bootstrap.php`
- Create: `includes/LocalAbilities.php`
- Modify: `includes/Application.php`
- Create: `tests/wpunit/LocalAbilitiesWPUnitTest.php`

**Interfaces:**
- Consumes: `NFD_EDITOR_CHAT_VERSION`, `NFD_EDITOR_CHAT_JS_URL` (new, this task) constants.
- Produces: `NewfoldLabs\WP\Module\EditorChat\LocalAbilities` — instantiating it registers an
  `enqueue_block_editor_assets` hook. Static method
  `LocalAbilities::get_enabled_ability_names(): array` returns the filtered ability-name list;
  Task 3's `js/abilities/index.js` reads this same list back from the browser via
  `script_module_data_@newfold-labs/editor-chat-local-abilities`.

- [ ] **Step 1: Define `NFD_EDITOR_CHAT_JS_URL` in `bootstrap.php`**

In `bootstrap.php`, immediately after the existing `NFD_EDITOR_CHAT_ASSETS_URL` block:

```php
			if ( ! \defined( 'NFD_EDITOR_CHAT_ASSETS_URL' ) ) {
				\define( 'NFD_EDITOR_CHAT_ASSETS_URL', $container->plugin()->url . 'vendor/newfold-labs/wp-module-editor-chat/assets/' );
			}
			if ( ! \defined( 'NFD_EDITOR_CHAT_JS_URL' ) ) {
				\define( 'NFD_EDITOR_CHAT_JS_URL', $container->plugin()->url . 'vendor/newfold-labs/wp-module-editor-chat/js/' );
			}
```

- [ ] **Step 2: Write the failing WPUnit tests for `LocalAbilities`**

Create `tests/wpunit/LocalAbilitiesWPUnitTest.php`:

```php
<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * LocalAbilities wpunit tests.
 *
 * @coversDefaultClass \NewfoldLabs\WP\Module\EditorChat\LocalAbilities
 */
class LocalAbilitiesWPUnitTest extends \lucatume\WPBrowser\TestCase\WPTestCase {

	/**
	 * Remove any filters a previous test left behind.
	 *
	 * @return void
	 */
	public function tearDown(): void {
		remove_all_filters( 'nfd_editor_chat_local_abilities_enabled' );
		remove_all_filters( 'nfd_editor_chat_local_ability_names' );
		remove_all_filters( 'script_module_data_@newfold-labs/editor-chat-local-abilities' );
		parent::tearDown();
	}

	/**
	 * Constructor registers the enqueue_block_editor_assets hook.
	 *
	 * @return void
	 */
	public function test_constructor_registers_enqueue_hook() {
		new LocalAbilities();

		$this->assertIsInt(
			has_action( 'enqueue_block_editor_assets', array( LocalAbilities::class, 'enqueue_local_abilities' ) )
		);
	}

	/**
	 * Default enabled ability names include editor/get-editor-tree.
	 *
	 * @return void
	 */
	public function test_get_enabled_ability_names_default() {
		$this->assertSame( array( 'editor/get-editor-tree' ), LocalAbilities::get_enabled_ability_names() );
	}

	/**
	 * The nfd_editor_chat_local_ability_names filter can narrow the list.
	 *
	 * @return void
	 */
	public function test_get_enabled_ability_names_respects_filter() {
		add_filter(
			'nfd_editor_chat_local_ability_names',
			function () {
				return array();
			}
		);

		$this->assertSame( array(), LocalAbilities::get_enabled_ability_names() );
	}

	/**
	 * enqueue_local_abilities() does nothing when script modules are unavailable.
	 *
	 * @return void
	 */
	public function test_enqueue_returns_early_without_script_modules_support() {
		if ( function_exists( 'wp_enqueue_script_module' ) ) {
			$this->markTestSkipped( 'This WordPress version supports script modules; cannot test the fallback branch.' );
		}

		LocalAbilities::enqueue_local_abilities();

		$this->assertFalse(
			has_filter( 'script_module_data_@newfold-labs/editor-chat-local-abilities' )
		);
	}

	/**
	 * enqueue_local_abilities() does nothing when nfd_editor_chat_local_abilities_enabled is false.
	 *
	 * @return void
	 */
	public function test_enqueue_returns_early_when_disabled_by_filter() {
		if ( ! function_exists( 'wp_enqueue_script_module' ) ) {
			$this->markTestSkipped( 'This WordPress version has no script modules support.' );
		}

		add_filter( 'nfd_editor_chat_local_abilities_enabled', '__return_false' );

		LocalAbilities::enqueue_local_abilities();

		$this->assertFalse(
			has_filter( 'script_module_data_@newfold-labs/editor-chat-local-abilities' )
		);
	}

	/**
	 * enqueue_local_abilities() registers the script-module-data filter when enabled.
	 *
	 * @return void
	 */
	public function test_enqueue_registers_script_module_data_filter_when_enabled() {
		if ( ! function_exists( 'wp_enqueue_script_module' ) ) {
			$this->markTestSkipped( 'This WordPress version has no script modules support.' );
		}

		LocalAbilities::enqueue_local_abilities();

		$this->assertIsInt(
			has_filter(
				'script_module_data_@newfold-labs/editor-chat-local-abilities',
				array( LocalAbilities::class, 'filter_local_abilities_script_module_data' )
			)
		);
	}

	/**
	 * filter_local_abilities_script_module_data() adds the ability-names key.
	 *
	 * @return void
	 */
	public function test_filter_local_abilities_script_module_data_adds_ability_names() {
		$result = LocalAbilities::filter_local_abilities_script_module_data( array() );

		$this->assertArrayHasKey( 'abilityNames', $result );
		$this->assertSame( array( 'editor/get-editor-tree' ), $result['abilityNames'] );
	}
}
```

- [ ] **Step 3: Run the tests and confirm they fail because `LocalAbilities` does not exist yet**

Run: `composer run test -- --filter LocalAbilitiesWPUnitTest`
Expected: FAIL — `Class "NewfoldLabs\WP\Module\EditorChat\LocalAbilities" not found`.

- [ ] **Step 4: Create `includes/LocalAbilities.php`**

```php
<?php

namespace NewfoldLabs\WP\Module\EditorChat;

/**
 * Registers the local (in-browser) editor abilities: WordPress client-side
 * abilities bridged to WebMCP, so the chat can call them with zero network
 * cost instead of a round trip to /blu/mcp.
 *
 * This class never touches /blu/mcp, wp-module-mcp, or ChatEditor's REST
 * routes — the local-abilities surface is deliberately self-contained here.
 * When the client-side Abilities API is unavailable (WordPress older than
 * 7.0, or wp_enqueue_script_module missing for any other reason), every
 * method here is a no-op and the rest of the module runs exactly as it does
 * today.
 */
final class LocalAbilities {

	/**
	 * Constructor.
	 */
	public function __construct() {
		\add_action( 'enqueue_block_editor_assets', array( __CLASS__, 'enqueue_local_abilities' ) );
	}

	/**
	 * Enqueue the local-abilities script modules and the WebMCP polyfill.
	 *
	 * @return void
	 */
	public static function enqueue_local_abilities() {
		if ( ! \function_exists( 'wp_enqueue_script_module' ) ) {
			return;
		}

		if ( ! \apply_filters( 'nfd_editor_chat_local_abilities_enabled', true ) ) {
			return;
		}

		// Ensure the Abilities client (and its import map entry) are available.
		\wp_enqueue_script_module( '@wordpress/abilities' );

		// Installs document.modelContext for the bridge to register tools into.
		\wp_register_script(
			'nfd-editor-chat-webmcp-polyfill',
			NFD_EDITOR_CHAT_JS_URL . 'vendor/webmcp-polyfill/webmcp-polyfill.js',
			array(),
			NFD_EDITOR_CHAT_VERSION
		);
		\wp_enqueue_script( 'nfd-editor-chat-webmcp-polyfill' );

		\wp_register_script_module(
			'@newfold-labs/editor-chat-webmcp-env',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/webmcp-polyfill.js',
			array(),
			NFD_EDITOR_CHAT_VERSION
		);

		\wp_register_script_module(
			'@newfold-labs/editor-chat-abilities',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/abilities.js',
			array( '@wordpress/abilities' ),
			NFD_EDITOR_CHAT_VERSION
		);

		\wp_register_script_module(
			'@newfold-labs/editor-chat-webmcp-bridge',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/webmcp-bridge.js',
			array( '@wordpress/abilities', '@newfold-labs/editor-chat-webmcp-env' ),
			NFD_EDITOR_CHAT_VERSION
		);

		\wp_enqueue_script_module(
			'@newfold-labs/editor-chat-local-abilities',
			NFD_EDITOR_CHAT_JS_URL . 'abilities/index.js',
			array( '@newfold-labs/editor-chat-abilities', '@newfold-labs/editor-chat-webmcp-bridge' ),
			NFD_EDITOR_CHAT_VERSION
		);

		\add_filter(
			'script_module_data_@newfold-labs/editor-chat-local-abilities',
			array( __CLASS__, 'filter_local_abilities_script_module_data' )
		);
	}

	/**
	 * Add the enabled ability names to the bootstrap script module's data.
	 *
	 * @param array $data Existing script module data.
	 * @return array
	 */
	public static function filter_local_abilities_script_module_data( $data ) {
		$data['abilityNames'] = self::get_enabled_ability_names();
		return $data;
	}

	/**
	 * Ability names the local layer is allowed to bridge to WebMCP this request.
	 *
	 * `editor/*` abilities not in this list are still registered with
	 * @wordpress/abilities (cheap, in-memory) but are never exposed as a
	 * WebMCP tool, so the model never sees them.
	 *
	 * @return string[]
	 */
	public static function get_enabled_ability_names() {
		return (array) \apply_filters(
			'nfd_editor_chat_local_ability_names',
			array( 'editor/get-editor-tree' )
		);
	}
}
```

- [ ] **Step 5: Wire `LocalAbilities` into `Application.php`**

In `includes/Application.php`, change `initialize_chat_editor()`:

```php
	public function initialize_chat_editor() {
		static $initialized = false;

		if ( $initialized ) {
			return;
		}

		$initialized = true;
		new ChatEditor();
		new LocalAbilities();
	}
```

- [ ] **Step 6: Run the tests again and confirm they pass**

Run: `composer run test -- --filter "LocalAbilitiesWPUnitTest|ApplicationWPUnitTest"`
Expected: PASS for all `LocalAbilitiesWPUnitTest` tests; `ApplicationWPUnitTest` still passes
unchanged (it asserts `ChatEditor` hooks specifically, so adding `LocalAbilities` alongside it
does not affect those assertions).

- [ ] **Step 7: Lint**

Run: `composer run lint`
Expected: no new errors from `includes/LocalAbilities.php` or the modified files.

- [ ] **Step 8: Commit**

```bash
git add bootstrap.php includes/LocalAbilities.php includes/Application.php tests/wpunit/LocalAbilitiesWPUnitTest.php
git commit -m "feat: add LocalAbilities PHP class for local editor abilities"
```

---

### Task 3: JS script-module layer — env probe, abilities, bridge, bootstrap

**Files:**
- Create: `js/abilities/webmcp-polyfill.js`
- Create: `js/abilities/abilities.js`
- Create: `js/abilities/webmcp-bridge.js`
- Create: `js/abilities/index.js`

**Interfaces:**
- Consumes: `@wordpress/abilities` (WordPress core script module), `window.wp.data` (classic
  global, block-editor store).
- Produces: on a supporting browser, `document.modelContext` gains a tool named
  `editor_get-editor-tree`; `window.nfdEditorAbilities` is set with
  `{ abilityNames, webmcp, isWebMCPSupported }`. Task 4 (`localToolRegistry.js`) consumes
  `document.modelContext` only — it does not import from this task's files directly (separate
  module graphs, see Global Constraints).

- [ ] **Step 1: Create `js/abilities/webmcp-polyfill.js`** (env probe; ported from
  contributor-day-editor-abilities, log prefix changed)

```js
/**
 * WebMCP environment.
 *
 * Chrome only exposes `document.modelContext` behind a flag, so the polyfill is
 * enqueued as a classic script alongside anything that needs WebMCP. It
 * installs itself on load and steps aside when the browser has native support,
 * which means one code path covers flagged Chrome, unflagged Chrome, and other
 * browsers.
 *
 * This module only reports on that environment; it never installs anything.
 *
 * @see https://www.npmjs.com/package/@mcp-b/webmcp-polyfill
 */

/**
 * @return {Object|null} The model context, or null when there is none.
 */
export function getModelContext() {
	if ( typeof document !== 'undefined' && document.modelContext ) {
		return document.modelContext;
	}
	// Deprecated alias, still the only surface on older Chromium builds.
	if ( typeof navigator !== 'undefined' && navigator.modelContext ) {
		return navigator.modelContext;
	}
	return null;
}

let warned = false;

/**
 * @return {{ available: boolean, polyfillLoaded: boolean, secureContext: boolean }}
 */
export function getWebMCPStatus() {
	const secureContext =
		typeof window !== 'undefined' ? window.isSecureContext !== false : false;
	const available = !! getModelContext()?.registerTool;

	if ( ! available && ! secureContext && ! warned ) {
		warned = true;
		console.warn(
			'[nfd-editor-chat] WebMCP is unavailable because this page is not a secure context. Serve the site over HTTPS or from localhost.'
		);
	}

	return {
		available,
		polyfillLoaded:
			typeof window !== 'undefined' && !! window.WebMCPPolyfill,
		secureContext,
	};
}
```

- [ ] **Step 2: Create `js/abilities/abilities.js`**

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

import {
	getAbility,
	getAbilityCategory,
	registerAbility,
	registerAbilityCategory,
} from '@wordpress/abilities';

const BLOCK_EDITOR_STORE = 'core/block-editor';

/**
 * @return {{ select: Function, dispatch: Function }}
 */
function getData() {
	const { data } = window.wp || {};
	if ( ! data?.select || ! data?.dispatch ) {
		throw new Error(
			'WordPress data store is not available. Open this ability in the block editor.'
		);
	}
	return data;
}

/**
 * Ensure the block editor store is mounted.
 */
function assertEditorReady() {
	const { select } = getData();
	if ( ! select( BLOCK_EDITOR_STORE ) ) {
		throw new Error(
			'Block editor store is not available. These abilities only work in the block editor.'
		);
	}
}

/**
 * @param {Object} store Block editor store selectors.
 * @param {Object} block
 * @return {{ innerBlocks: Object[], controlled: boolean }}
 */
function getInnerBlocks( store, block ) {
	if ( store?.areInnerBlocksControlled?.( block.clientId ) ) {
		return {
			innerBlocks: store.getBlocks( block.clientId ) || [],
			controlled: true,
		};
	}
	return { innerBlocks: block.innerBlocks || [], controlled: false };
}

/**
 * Extend the set of pattern entities on the current path, so a pattern that
 * references itself (directly or through another pattern) cannot loop forever.
 *
 * @param {Object}   block
 * @param {Set<any>} visitedRefs
 * @return {?Set<any>} Set for the children, or null when this entity repeats.
 */
function withControlledRef( block, visitedRefs ) {
	const ref = block.attributes?.ref;
	if ( ref === undefined ) {
		return visitedRefs;
	}
	if ( visitedRefs.has( ref ) ) {
		return null;
	}
	return new Set( visitedRefs ).add( ref );
}

/**
 * Serialize a block (and descendants) into a compact tree node.
 *
 * @param {Object}   store         Block editor store selectors.
 * @param {Object}   block
 * @param {number}   [maxDepth]    Depth of descendants to include.
 * @param {number}   [depth]
 * @param {Set<any>} [visitedRefs] Pattern entities on the current path.
 * @return {Object}
 */
function serializeBlock(
	store,
	block,
	maxDepth = Infinity,
	depth = 0,
	visitedRefs = new Set()
) {
	const { innerBlocks, controlled } = getInnerBlocks( store, block );
	const node = {
		clientId: block.clientId,
		name: block.name,
		attributes: block.attributes ?? {},
	};

	if ( controlled ) {
		node.controlledInnerBlocks = true;
	}

	const childRefs = controlled
		? withControlledRef( block, visitedRefs )
		: visitedRefs;

	if ( depth >= maxDepth || childRefs === null ) {
		node.innerBlocks = [];
		node.truncatedInnerBlockCount = innerBlocks.length;
		return node;
	}

	node.innerBlocks = innerBlocks.map( ( innerBlock ) =>
		serializeBlock( store, innerBlock, maxDepth, depth + 1, childRefs )
	);
	return node;
}

/**
 * @param {string} slug
 * @param {Object} args
 */
function ensureAbilityCategory( slug, args ) {
	if ( ! getAbilityCategory( slug ) ) {
		registerAbilityCategory( slug, args );
	}
}

/**
 * Ensure an ability exists without throwing if it was already registered.
 *
 * @param {Object} ability
 */
function ensureAbility( ability ) {
	if ( ! getAbility( ability.name ) ) {
		registerAbility( ability );
	}
}

/**
 * Register the block-editor category and local editor abilities.
 *
 * @return {string[]} Registered ability names.
 */
export function registerEditorAbilities() {
	ensureAbilityCategory( 'block-editor', {
		label: 'Block Editor',
		description:
			'Abilities for inspecting and modifying the WordPress block editor.',
	} );

	const abilityNames = [];

	ensureAbility( {
		name: 'editor/get-editor-tree',
		label: 'Get Editor Tree',
		description:
			'Returns the full hierarchical block tree for the current editor document.',
		category: 'block-editor',
		input_schema: {
			type: 'object',
			properties: {
				maxDepth: {
					type: 'integer',
					minimum: 0,
					description:
						'Levels of nested blocks to include. Omit for the whole tree. Truncated nodes report truncatedInnerBlockCount.',
				},
			},
			additionalProperties: false,
		},
		output_schema: {
			type: 'object',
			properties: {
				blocks: {
					type: 'array',
					description: 'Top-level blocks and their descendants.',
				},
				count: {
					type: 'integer',
					description: 'Number of top-level blocks.',
				},
			},
			required: [ 'blocks', 'count' ],
		},
		meta: {
			annotations: {
				readonly: true,
				destructive: false,
				idempotent: true,
			},
		},
		callback: async ( { maxDepth } = {} ) => {
			assertEditorReady();
			const { select } = getData();

			if ( maxDepth !== undefined && ! ( maxDepth >= 0 ) ) {
				throw new Error( 'maxDepth must be zero or greater.' );
			}

			const depthLimit = maxDepth === undefined ? Infinity : maxDepth;
			const store = select( BLOCK_EDITOR_STORE );
			const tree = store
				.getBlocks()
				.map( ( block ) => serializeBlock( store, block, depthLimit ) );
			return { blocks: tree, count: tree.length };
		},
	} );
	abilityNames.push( 'editor/get-editor-tree' );

	return abilityNames;
}
```

- [ ] **Step 3: Create `js/abilities/webmcp-bridge.js`**

This is ported from contributor-day-editor-abilities's `js/webmcp-bridge.js`, with one
deliberate simplification: contributor-day's bridge also calls `rememberLocalTool()` into an
in-memory registry its own chat panel imports as the same shared module instance (via the
browser's import map). That trick does not apply here — `src/services/localToolRegistry.js`
(Task 4) is bundled by webpack into a *different* module graph, so it cannot share an in-memory
Map with this script module. It reads `document.modelContext` instead, which is the one surface
both sides can reach. `rememberLocalTool` is therefore left out.

```js
/**
 * Bridge WordPress client-side abilities to the WebMCP Imperative API.
 *
 * @see https://developer.chrome.com/docs/ai/webmcp
 */

import { executeAbility, getAbility } from '@wordpress/abilities';
import { getModelContext } from '@newfold-labs/editor-chat-webmcp-env';

/**
 * WebMCP tool names may include alphanumerics, _, -, and .
 * Convert ability names like "editor/get-editor-tree" -> "editor_get-editor-tree".
 *
 * @param {string} abilityName
 * @return {string}
 */
export function toToolName( abilityName ) {
	return abilityName.replace( /\//g, '_' );
}

/**
 * @param {Object} [ability]
 * @return {{ readOnlyHint: boolean }|undefined}
 */
function toToolAnnotations( ability ) {
	const annotations = ability?.meta?.annotations;
	if ( ! annotations ) {
		return undefined;
	}

	// Only WebMCP-supported annotation keys (unknown keys can break registration).
	return {
		readOnlyHint: !! annotations.readonly,
	};
}

/**
 * @param {unknown} result
 * @return {{ content: Array<{ type: string, text: string }>, structuredContent?: Object }}
 */
function formatToolResult( result ) {
	if ( result === undefined ) {
		return { content: [ { type: 'text', text: '' } ] };
	}

	const text =
		typeof result === 'string' ? result : JSON.stringify( result, null, 2 );
	const formatted = { content: [ { type: 'text', text } ] };

	if (
		result !== null &&
		typeof result === 'object' &&
		! Array.isArray( result )
	) {
		formatted.structuredContent = result;
	}

	return formatted;
}

/**
 * Surface ability failures as tool errors the agent can read and retry from,
 * rather than rejecting the execute() call.
 *
 * @param {unknown} error
 * @return {{ content: Array<{ type: string, text: string }>, isError: true }}
 */
function formatToolError( error ) {
	return {
		content: [ { type: 'text', text: String( error?.message || error ) } ],
		isError: true,
	};
}

/**
 * Copy a JSON Schema, recursing into properties and items.
 *
 * @param {Object}  schema
 * @param {boolean} collapseNullableTypes Replace ['string','null'] with 'string'.
 * @return {Object|undefined}
 */
function normalizeSchema( schema, collapseNullableTypes ) {
	if ( ! schema || typeof schema !== 'object' ) {
		return undefined;
	}

	const normalized = { ...schema };

	if ( collapseNullableTypes && Array.isArray( normalized.type ) ) {
		const nonNull = normalized.type.filter( ( type ) => type !== 'null' );
		normalized.type = nonNull[ 0 ] || 'string';
	}

	if ( normalized.properties && typeof normalized.properties === 'object' ) {
		const properties = {};
		for ( const [ key, value ] of Object.entries(
			normalized.properties
		) ) {
			const property = normalizeSchema( value, collapseNullableTypes );
			if ( property ) {
				properties[ key ] = property;
			}
		}
		normalized.properties = properties;
	}

	if ( normalized.items ) {
		normalized.items =
			normalizeSchema( normalized.items, collapseNullableTypes ) ??
			normalized.items;
	}

	return normalized;
}

/**
 * @param {Object} [schema]
 * @return {Object}
 */
function toToolInputSchema( schema ) {
	const normalized = normalizeSchema( schema, true );
	if ( ! normalized || normalized.type !== 'object' ) {
		return { type: 'object', properties: {} };
	}

	if (
		! normalized.properties ||
		typeof normalized.properties !== 'object'
	) {
		normalized.properties = {};
	}

	return normalized;
}

/**
 * @param {Object} [schema]
 * @return {Object|undefined}
 */
function toToolOutputSchema( schema ) {
	const normalized = normalizeSchema( schema, false );
	if ( ! normalized || normalized.type !== 'object' ) {
		return undefined;
	}
	return normalized;
}

/**
 * @param {unknown} error
 * @return {boolean}
 */
function isAlreadyRegisteredError( error ) {
	if ( error?.name === 'InvalidStateError' ) {
		return true;
	}
	return /already/i.test( String( error?.message || error ) );
}

/**
 * @return {boolean}
 */
function isDocumentLoaded() {
	if ( typeof document === 'undefined' || ! document.readyState ) {
		return true;
	}
	return document.readyState === 'complete';
}

/**
 * Wait briefly for WebMCP to become available (flag / document ready races).
 *
 * @param {number} [timeoutMs]
 * @param {number} [graceAfterLoadMs]
 * @return {Promise<Object|null>}
 */
async function waitForModelContext( timeoutMs = 3000, graceAfterLoadMs = 500 ) {
	const started = Date.now();
	let loadedAt = isDocumentLoaded() ? started : null;

	while ( Date.now() - started < timeoutMs ) {
		const modelContext = getModelContext();
		if ( modelContext?.registerTool ) {
			return modelContext;
		}

		if ( loadedAt === null && isDocumentLoaded() ) {
			loadedAt = Date.now();
		}
		if ( loadedAt !== null && Date.now() - loadedAt >= graceAfterLoadMs ) {
			break;
		}

		await new Promise( ( resolve ) => window.setTimeout( resolve, 50 ) );
	}

	return getModelContext();
}

/**
 * Register one ability as a page-lifetime WebMCP tool (no AbortSignal — see
 * docs/superpowers/specs/2026-09-11-local-editor-abilities-design.md, "Do not
 * register WebMCP tools with a shared AbortController for page-lifetime tools").
 *
 * @param {string} abilityName
 * @param {Object} modelContext
 * @return {Promise<boolean>}
 */
async function registerAbilityAsWebMCPTool( abilityName, modelContext ) {
	const ability = getAbility( abilityName );
	if ( ! ability ) {
		throw new Error( `Ability not found: ${ abilityName }` );
	}

	const tool = {
		name: toToolName( abilityName ),
		description: ability.description || ability.label || abilityName,
		inputSchema: toToolInputSchema( ability.input_schema ),
		execute: async ( input = {} ) => {
			try {
				const result = await executeAbility( abilityName, input || {} );
				return formatToolResult( result );
			} catch ( error ) {
				console.warn(
					`[nfd-editor-chat] Local ability failed: ${ abilityName }`,
					error
				);
				return formatToolError( error );
			}
		},
	};

	const optional = {};
	const outputSchema = toToolOutputSchema( ability.output_schema );
	if ( outputSchema ) {
		optional.outputSchema = outputSchema;
	}
	const annotations = toToolAnnotations( ability );
	if ( annotations ) {
		optional.annotations = annotations;
	}

	try {
		await modelContext.registerTool( { ...tool, ...optional } );
	} catch ( error ) {
		if ( isAlreadyRegisteredError( error ) ) {
			throw error;
		}
		// Older WebMCP builds reject descriptor keys they do not know about;
		// a tool without hints beats no tool at all.
		await modelContext.registerTool( tool );
	}

	return true;
}

/**
 * Bridge abilities to WebMCP.
 *
 * @param {string[]} abilityNames
 * @return {Promise<{ supported: boolean, registered: string[], skipped: string[], errors: Object[] }>}
 */
export async function bridgeAbilitiesToWebMCP( abilityNames ) {
	const modelContext = await waitForModelContext();
	if ( ! modelContext?.registerTool ) {
		return {
			supported: false,
			registered: [],
			skipped: [ ...abilityNames ],
			errors: [],
		};
	}

	const registered = [];
	const skipped = [];
	const errors = [];

	for ( const name of abilityNames ) {
		try {
			await registerAbilityAsWebMCPTool( name, modelContext );
			registered.push( name );
		} catch ( error ) {
			const message = String( error?.message || error );
			if ( isAlreadyRegisteredError( error ) ) {
				registered.push( name );
				continue;
			}

			console.warn(
				`[nfd-editor-chat] Failed to register WebMCP tool for ${ name }:`,
				error
			);
			skipped.push( name );
			errors.push( { name, message } );
		}
	}

	return { supported: true, registered, skipped, errors };
}

/**
 * @return {boolean}
 */
export function isWebMCPSupported() {
	const modelContext = getModelContext();
	return !! ( modelContext && 'registerTool' in modelContext );
}
```

- [ ] **Step 4: Create `js/abilities/index.js`**

```js
/**
 * Local editor abilities — bootstrap entry.
 *
 * Registers the editor/* abilities (abilities.js) then bridges the subset
 * PHP has enabled (LocalAbilities::get_enabled_ability_names(), read back
 * here from script_module_data) to WebMCP (webmcp-bridge.js), so the chat
 * (a separate bundle — see src/services/localToolRegistry.js) can call them
 * through document.modelContext with zero network cost.
 */

import { registerEditorAbilities } from '@newfold-labs/editor-chat-abilities';
import {
	bridgeAbilitiesToWebMCP,
	isWebMCPSupported,
	toToolName,
} from '@newfold-labs/editor-chat-webmcp-bridge';

/**
 * Read the ability names PHP enabled for this request.
 *
 * Uses the exact pattern WordPress core documents for reading script module
 * data (see wp-includes/class-wp-script-modules.php, print_script_module_data()).
 *
 * @return {string[]}
 */
function getAllowedAbilityNames() {
	const dataContainer = document.querySelector(
		'script[id="wp-script-module-data-@newfold-labs/editor-chat-local-abilities"]'
	);
	let data = {};
	if ( dataContainer instanceof HTMLScriptElement ) {
		try {
			data = JSON.parse( dataContainer.text );
		} catch {}
	}
	return Array.isArray( data?.abilityNames ) ? data.abilityNames : [];
}

/** @type {Promise<void>|null} */
let bootstrapPromise = null;

async function bootstrap() {
	if ( bootstrapPromise ) {
		return bootstrapPromise;
	}

	bootstrapPromise = ( async () => {
		const registeredNames = registerEditorAbilities();
		const allowedNames = getAllowedAbilityNames();
		const abilityNames = registeredNames.filter( ( name ) =>
			allowedNames.includes( name )
		);

		window.nfdEditorAbilities = {
			abilityNames,
			webmcp: null,
			isWebMCPSupported: isWebMCPSupported(),
		};

		const bridgeResult = await bridgeAbilitiesToWebMCP( abilityNames );

		window.nfdEditorAbilities = {
			abilityNames,
			webmcp: bridgeResult,
			isWebMCPSupported: isWebMCPSupported(),
		};

		if ( bridgeResult.supported ) {
			console.info(
				'[nfd-editor-chat] Registered local editor abilities with WebMCP:',
				bridgeResult.registered.map( toToolName )
			);
		} else {
			console.info(
				'[nfd-editor-chat] Editor abilities registered, but WebMCP is unavailable and the polyfill could not install (this page may not be a secure context).',
				abilityNames
			);
		}
	} )();

	return bootstrapPromise;
}

bootstrap().catch( ( error ) => {
	bootstrapPromise = null;
	console.error(
		'[nfd-editor-chat] Failed to bootstrap local editor abilities:',
		error
	);
} );
```

- [ ] **Step 5: Manual verification — abilities register in a real editor**

Run `npm run build` (unchanged build; these files are not part of it) and load a post editor
screen on a WordPress 7.0+ install (e.g. `post-new.php`), then in DevTools:

```js
window.nfdEditorAbilities
// Expect: { abilityNames: ['editor/get-editor-tree'], webmcp: { supported: true, registered: [...], skipped: [], errors: [] }, isWebMCPSupported: true }

await document.modelContext.getTools()
// Expect: an array containing one tool with name "editor_get-editor-tree"
```

Expected console line: `[nfd-editor-chat] Registered local editor abilities with WebMCP: ['editor_get-editor-tree']`.

- [ ] **Step 6: Spot-check the ability directly**

In the same DevTools console:

```js
const tools = await document.modelContext.getTools();
const tool = tools.find((t) => t.name === 'editor_get-editor-tree');
JSON.parse(await document.modelContext.executeTool(tool, '{}'));
```

Expected: `{ content: [{ type: 'text', text: '...' }], structuredContent: { blocks: [...], count: N } }`
matching the blocks currently in the editor.

- [ ] **Step 7: Commit**

```bash
git add js/abilities
git commit -m "feat: add local editor-abilities script-module layer (editor/get-editor-tree)"
```

---

### Task 4: `src/services/localToolRegistry.js` (webpack world)

**Files:**
- Create: `src/services/localToolRegistry.js`

**Interfaces:**
- Consumes: `document.modelContext` (global, installed by Task 1's polyfill + Task 3's bridge).
- Produces:
  - `isLocalToolName(name: string): boolean`
  - `listLocalTools(): Promise<Array<{name: string, description: string, inputSchema: Object}>>`
  - `runLocalTool(name: string, args: Object): Promise<{isError: boolean, text: string}>`
  - `mergeLocalAndMcpTools(localTools: Array, mcpTools: Array, supersededMcpNames?: string[]): Array`

  Task 5 consumes `isLocalToolName` and `runLocalTool`. Task 6 consumes `listLocalTools` and
  `mergeLocalAndMcpTools`.

- [ ] **Step 1: Create `src/services/localToolRegistry.js`**

```js
/**
 * Local tool registry (webpack world).
 *
 * Reads whatever js/abilities/ (a separate, hand-written script-module
 * layer — see that directory) registered on document.modelContext (WebMCP).
 * This file cannot share an in-memory registry with js/abilities/webmcp-bridge.js
 * directly: that file runs as a WordPress script module, this one is bundled
 * by webpack into the chat entry, and the two are separate module graphs
 * with no shared import-map specifier between them. document.modelContext is
 * the one surface both sides can reach, so every local tool call goes
 * through it.
 *
 * Every tool js/abilities/ registers is named editor_<something> (see
 * js/abilities/webmcp-bridge.js toToolName()); that prefix is how this file
 * tells a local editor ability apart from any other WebMCP tool a different
 * plugin might register on the same page.
 */

const LOCAL_TOOL_PREFIX = "editor_";

function getModelContext() {
	if (typeof document !== "undefined" && document.modelContext) {
		return document.modelContext;
	}
	if (typeof navigator !== "undefined" && navigator.modelContext) {
		return navigator.modelContext;
	}
	return null;
}

function parseMaybeJson(value) {
	if (typeof value !== "string") {
		return value;
	}
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

/**
 * Whether a tool name belongs to the local editor-abilities layer.
 *
 * @param {string} name
 * @return {boolean}
 */
export function isLocalToolName(name) {
	return typeof name === "string" && name.startsWith(LOCAL_TOOL_PREFIX);
}

/**
 * Local (editor_*) WebMCP tools currently registered on this page, or an
 * empty array when the client-side Abilities API never registered (older
 * WordPress, or nfd_editor_chat_local_abilities_enabled returned false).
 *
 * @return {Promise<Array<{name: string, description: string, inputSchema: Object}>>}
 */
export async function listLocalTools() {
	const modelContext = getModelContext();
	if (typeof modelContext?.getTools !== "function") {
		return [];
	}

	try {
		const tools = await modelContext.getTools();
		return (tools || []).filter((tool) => isLocalToolName(tool?.name));
	} catch (error) {
		console.warn("[nfd-editor-chat] Could not list local editor tools:", error);
		return [];
	}
}

/**
 * Run a local editor ability by tool name.
 *
 * Tool failures are returned, not thrown — a failed call is something the
 * model should see and be able to correct, same convention as every other
 * tool result in toolDispatcher.js.
 *
 * @param {string} name Tool name, e.g. "editor_get-editor-tree".
 * @param {Object} args Arguments for the tool.
 * @return {Promise<{isError: boolean, text: string}>}
 */
export async function runLocalTool(name, args = {}) {
	const modelContext = getModelContext();
	if (typeof modelContext?.executeTool !== "function" || typeof modelContext?.getTools !== "function") {
		return {
			isError: true,
			text: JSON.stringify({ error: `Local editor tool "${name}" is unavailable on this page.` }),
		};
	}

	try {
		const tools = await modelContext.getTools();
		const tool = (tools || []).find((t) => t?.name === name);
		if (!tool) {
			return { isError: true, text: JSON.stringify({ error: `Unknown local editor tool: ${name}` }) };
		}

		const raw = await modelContext.executeTool(tool, JSON.stringify(args ?? {}));
		const parsed = parseMaybeJson(raw);
		const isError = !!parsed?.isError;
		const content = Array.isArray(parsed?.content) ? parsed.content : [];
		const text = content
			.filter((block) => block?.type === "text")
			.map((block) => block.text)
			.join("\n");

		return { isError, text: text || JSON.stringify(parsed) };
	} catch (error) {
		return { isError: true, text: JSON.stringify({ error: String(error?.message || error) }) };
	}
}

/**
 * Merge local editor abilities with the MCP tool list for this session,
 * ready for mcpToolsToOpenAI(). No MCP ability is ever removed server-side —
 * only kept out of *this request's* tool list, and only when explicitly
 * declared superseded, so the model is steered onto the fast path without
 * ever losing the MCP fallback on a session where the local one is absent.
 *
 * @param {Array<Object>} localTools         From listLocalTools().
 * @param {Array<Object>} mcpTools           From mcpClient.listTools().
 * @param {string[]}       [supersededMcpNames] MCP tool names to omit this
 *   session because a local ability already covers the same operation.
 *   Empty until a specific editor/* ability is confirmed to replace a named
 *   MCP ability (see docs/local-abilities.md).
 * @return {Array<Object>}
 */
export function mergeLocalAndMcpTools(localTools, mcpTools, supersededMcpNames = []) {
	const superseded = new Set(supersededMcpNames);
	const filteredMcpTools = (mcpTools || []).filter((tool) => !superseded.has(tool?.name));
	return [...(localTools || []), ...filteredMcpTools];
}
```

- [ ] **Step 2: Manual verification — from the same editor screen as Task 3**

In DevTools, with the chat bundle loaded on the page (any post editor screen):

```js
const { listLocalTools, runLocalTool, isLocalToolName, mergeLocalAndMcpTools } =
	await import('/wp-content/plugins/YOUR-BRAND-PLUGIN/vendor/newfold-labs/wp-module-editor-chat/build/<version>/chat-editor.js')
```

This import path only works if the module is exposed on the built bundle; if it is not (webpack
typically does not expose internal modules), instead verify indirectly through Task 5 and 6's
manual checks — this step exists to catch a syntax error early via `npm run lint:js`:

```bash
npm run lint:js
```
Expected: no errors in `src/services/localToolRegistry.js`.

- [ ] **Step 3: Commit**

```bash
git add src/services/localToolRegistry.js
git commit -m "feat: add local tool registry for the editor-chat dispatcher"
```

---

### Task 5: Wire local tools into `toolDispatcher.js`

**Files:**
- Modify: `src/services/toolDispatcher.js:1-30` (imports), `:505-551` (triage + server-tool loop)

**Interfaces:**
- Consumes: `isLocalToolName`, `runLocalTool` from `./localToolRegistry` (Task 4).
- Produces: no new exports; `executeToolCallsForREST()`'s behavior gains a third bucket.

- [ ] **Step 1: Add the import**

In `src/services/toolDispatcher.js`, near the other local imports (after the `callAbility`
import):

```js
import { callAbility, mcpResultIsError } from "./callAbility";
import { isLocalToolName, runLocalTool } from "./localToolRegistry";
```

- [ ] **Step 2: Replace the triage + server-tool loop**

Find this block (currently lines ~505-551):

```js
	// Separate client-side (blu-*) and server-side tools
	const clientToolCalls = [];
	const serverToolCalls = [];
	for (const tc of toolCalls) {
		const name = tc.name || "";
		if (name.startsWith("blu-")) {
			clientToolCalls.push(tc);
		} else {
			serverToolCalls.push(tc);
		}
	}

	// Execute server-side tools via MCP
	for (const tc of serverToolCalls) {
		if (ctx.abortSignal?.aborted) {
			toolResults.push(cancelledResult(tc));
			continue;
		}

		const mcpName = tc.name || "";
		try {
			const mcpResult = await ctx.mcpClient.callTool(mcpName, tc.arguments || {});
			const content = typeof mcpResult === "string" ? mcpResult : JSON.stringify(mcpResult);
			toolResults.push({
				tool_call_id: tc.id,
				content,
				isError: false,
			});
			completedToolsList.push({ ...tc, isError: false });
			ctx.setExecutedTools((prev) => [...prev, { ...tc, isError: false }]);
		} catch (err) {
			toolResults.push({
				tool_call_id: tc.id,
				content: JSON.stringify({ error: err.message }),
				isError: true,
			});
			completedToolsList.push({ ...tc, isError: true, errorMessage: err.message });
			ctx.setExecutedTools((prev) => [
				...prev,
				{ ...tc, isError: true, errorMessage: err.message },
			]);
		}
	}

	if (clientToolCalls.length === 0) {
		return toolResults;
	}
```

Replace it with:

```js
	// Separate local (editor_*), client-side (blu-*), and server-side tools.
	// Local tools are this session's WebMCP-registered abilities (see
	// src/services/localToolRegistry.js) — resolved with zero network cost
	// when the client-side Abilities API is available; every other tool name
	// keeps going through the existing client/server split unchanged.
	const localToolCallList = [];
	const clientToolCalls = [];
	const serverToolCalls = [];
	for (const tc of toolCalls) {
		const name = tc.name || "";
		if (isLocalToolName(name)) {
			localToolCallList.push(tc);
		} else if (name.startsWith("blu-")) {
			clientToolCalls.push(tc);
		} else {
			serverToolCalls.push(tc);
		}
	}

	// Execute local editor abilities (source: 'local') — no MCP round trip.
	for (const tc of localToolCallList) {
		if (ctx.abortSignal?.aborted) {
			toolResults.push(cancelledResult(tc));
			continue;
		}

		const args = typeof tc.arguments === "string" ? safeParseJSON(tc.arguments).value : tc.arguments || {};
		const { isError, text } = await runLocalTool(tc.name, args || {});
		logger.log(`[ToolExecutor:REST] Executed local ability ${tc.name} (source: local)`);
		toolResults.push({
			tool_call_id: tc.id,
			content: text,
			isError,
		});
		completedToolsList.push({ ...tc, isError, source: "local" });
		ctx.setExecutedTools((prev) => [...prev, { ...tc, isError, source: "local" }]);
	}

	// Execute server-side tools via MCP (source: 'mcp')
	for (const tc of serverToolCalls) {
		if (ctx.abortSignal?.aborted) {
			toolResults.push(cancelledResult(tc));
			continue;
		}

		const mcpName = tc.name || "";
		try {
			const mcpResult = await ctx.mcpClient.callTool(mcpName, tc.arguments || {});
			const content = typeof mcpResult === "string" ? mcpResult : JSON.stringify(mcpResult);
			toolResults.push({
				tool_call_id: tc.id,
				content,
				isError: false,
			});
			completedToolsList.push({ ...tc, isError: false, source: "mcp" });
			ctx.setExecutedTools((prev) => [...prev, { ...tc, isError: false, source: "mcp" }]);
		} catch (err) {
			toolResults.push({
				tool_call_id: tc.id,
				content: JSON.stringify({ error: err.message }),
				isError: true,
			});
			completedToolsList.push({ ...tc, isError: true, errorMessage: err.message, source: "mcp" });
			ctx.setExecutedTools((prev) => [
				...prev,
				{ ...tc, isError: true, errorMessage: err.message, source: "mcp" },
			]);
		}
	}

	if (clientToolCalls.length === 0) {
		return toolResults;
	}
```

Note: `clientToolCalls` (the `blu-*` branch below this block, unmodified) is left without a
`source` tag in this plan — tagging it accurately means touching each of its ~15 named handler
branches individually, which is real work but out of scope until a follow-up plan actually
migrates one of those handlers to a local ability (Rollout Stage 3 in the spec). Nothing about
its behavior changes here.

- [ ] **Step 3: Lint**

Run: `npm run lint:js`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

On a post editor screen with the chat sidebar open, send a prompt that only needs
`editor_get-editor-tree` (e.g. "How many blocks are in this post?"). In DevTools console (filtered
to `[ToolExecutor:REST]`), confirm the line `Executed local ability editor_get-editor-tree
(source: local)` appears and no request to `/blu/mcp` fires for that call — check the Network
tab for the absence of a matching `blu-call-ability`/`blu-get-editor-tree` request.

- [ ] **Step 5: Commit**

```bash
git add src/services/toolDispatcher.js
git commit -m "feat: dispatch editor_* tool calls to the local ability registry first"
```

---

### Task 6: Merge local tools into the model's tool list

**Files:**
- Modify: `src/hooks/chat/useSessionConfig.js`

**Interfaces:**
- Consumes: `listLocalTools`, `mergeLocalAndMcpTools` from `../../services/localToolRegistry`
  (Task 4); existing `mcpToolsToOpenAI` from `./conversationUtils` (unchanged).

- [ ] **Step 1: Add the import**

In `src/hooks/chat/useSessionConfig.js`:

```js
import { mcpToolsToOpenAI } from "./conversationUtils";
import { listLocalTools, mergeLocalAndMcpTools } from "../../services/localToolRegistry";
```

- [ ] **Step 2: Merge local tools before converting to OpenAI format**

Find:

```js
				const availableTools = await mcpClient.listTools();
				setOpenaiTools(mcpToolsToOpenAI(availableTools));
```

Replace with:

```js
				const availableTools = await mcpClient.listTools();
				const localTools = await listLocalTools();
				setOpenaiTools(mcpToolsToOpenAI(mergeLocalAndMcpTools(localTools, availableTools)));
```

- [ ] **Step 3: Lint**

Run: `npm run lint:js`
Expected: no new errors.

- [ ] **Step 4: Manual verification**

On a post editor screen with the chat sidebar open, in DevTools:

```js
window.__NFD_EDITOR_CHAT_DEBUG__?.openaiTools // if such a debug hook exists; otherwise:
```

If there is no existing debug hook for the tool list, instead verify indirectly: open the chat,
send any message, and check the outgoing request to the CF Worker (Network tab) — its `tools`
array should include an entry named `editor_get-editor-tree` alongside the existing `blu-*`
entries.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/chat/useSessionConfig.js
git commit -m "feat: include local editor abilities in the model's tool list"
```

---

### Task 7: Documentation

**Files:**
- Create: `docs/local-abilities.md`
- Modify: `docs/index.md`
- Modify: `docs/overview.md`

- [ ] **Step 1: Create `docs/local-abilities.md`**

```markdown
---
name: wp-module-editor-chat
title: Local editor abilities
description: How the local (in-browser) abilities layer works, and its hooks.
updated: 2026-09-11
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
| `nfd_editor_chat_local_ability_names` | Filter, array, default `['editor/get-editor-tree']`. Narrows or extends which registered `editor/*` abilities are bridged to WebMCP (and therefore visible to the model) this request. |

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

- [ ] **Step 2: Add it to `docs/index.md`**

```markdown
| [local-abilities.md](local-abilities.md) | The local (in-browser) abilities layer and its hooks. |
```
(insert this row after the `integration.md` row, before `development.md`)

- [ ] **Step 3: Add a bullet to `docs/overview.md`**

In the `## Features` list, after the existing `**MCP integration**` bullet:

```markdown
- **Local execution** — Tool calls that only need the currently open document (e.g. reading the
  block tree) run as local WordPress client-side abilities bridged to WebMCP, with zero network
  round trip, instead of always going through the MCP gateway. See
  [local-abilities.md](local-abilities.md).
```

- [ ] **Step 4: Commit**

```bash
git add docs/local-abilities.md docs/index.md docs/overview.md
git commit -m "docs: document the local editor-abilities layer and its hooks"
```

---

### Task 8: End-to-end verification checklist

**Files:** none (verification only).

- [ ] **Step 1: Fresh-checkout sanity check**

```bash
npm install
npm run vendor
npm run build
composer install
composer run test -- --filter "LocalAbilitiesWPUnitTest|ApplicationWPUnitTest|ChatEditorWPUnitTest"
composer run lint
npm run lint:js
```
Expected: everything passes; no regressions in the two unmodified PHP test files.

- [ ] **Step 2: Full manual pass on a real WordPress 7.0+ install**

Repeat Task 3 Steps 5-6, Task 5 Step 4, and Task 6 Step 4 in one sitting, on a fresh page load
(hard refresh), in this order:
1. `window.nfdEditorAbilities` and `document.modelContext.getTools()` both show
   `editor_get-editor-tree`.
2. The tool survives — call `getTools()` again after a few seconds; the tool must not disappear
   (this is the exact regression the spec's "Do not register WebMCP tools with a shared
   AbortController" rule exists to prevent).
3. A chat prompt needing only the block tree resolves via the local path (no `/blu/mcp` request,
   `source: local` in the console).
4. A chat prompt needing something the local layer does not cover (e.g. "add a new paragraph
   block") still resolves via the existing `blu-*`/MCP path, unaffected.

- [ ] **Step 3: Fallback check on WordPress < 7.0 (or with the filter disabled)**

Either point at a pre-7.0 WordPress install, or add temporarily to a must-use plugin:
```php
add_filter( 'nfd_editor_chat_local_abilities_enabled', '__return_false' );
```
Confirm: no console errors from the local-abilities layer, `window.nfdEditorAbilities` is
`undefined`, `document.modelContext` is `undefined` or has no tools, and the chat behaves exactly
as it does on `main` today (100% MCP/`blockActions.js`).

- [ ] **Step 4: Report results**

No commit for this task — it is the go/no-go gate before starting the next plan (Rollout Stage
2: more read abilities). If Step 3 reveals any regression, fix it before proceeding; do not
carry a known regression into the next plan.

---

## Self-Review Notes

- **Spec coverage:** Architecture (script-module layer decoupled from webpack bundle) → Tasks
  1-3. Components table → Tasks 2-4. Code-clarity section (one PHP class, dedicated routing
  module, `editor_` prefix, `source` tagging, documented hooks, plain docblocks) → Tasks 2, 4, 5,
  7. Data flow → Tasks 3, 5, 6. Error handling (readable tool errors, not-found-vs-throws,
  fail-soft) → Tasks 3 Step 3/`webmcp-bridge.js` `formatToolError`, 4's `runLocalTool`, 2's
  `function_exists` guard. Testing → Task 2 (WPUnit), Tasks 3/4/5/6 (manual, per the spec's
  explicit no-new-test-infra decision), Task 8 (end-to-end). Rollout plan Stage 1 → this entire
  plan. Stages 2-4 are explicitly out of scope, left for follow-up plans.
- **Deviation from default TDD flow:** JS tasks verify manually rather than writing failing
  Jest tests first, because this module and its reference implementation both have no JS test
  runner today and the approved spec explicitly chose not to introduce one. Called out in
  Global Constraints so this isn't mistaken for a gap.
- **Type/name consistency checked:** `isLocalToolName`/`runLocalTool`/`listLocalTools`/
  `mergeLocalAndMcpTools` (Task 4) are the exact names imported in Tasks 5 and 6.
  `LocalAbilities::get_enabled_ability_names()` (Task 2) returns the same default
  (`['editor/get-editor-tree']`) that Task 2's own tests assert and that Task 3's
  `getAllowedAbilityNames()` expects to find under the `abilityNames` key. Script module IDs
  (`@newfold-labs/editor-chat-webmcp-env`, `-abilities`, `-webmcp-bridge`, `-local-abilities`)
  match between Task 2's PHP registration and Task 3's JS imports and the
  `script_module_data_@newfold-labs/editor-chat-local-abilities` filter/DOM-id pair.
