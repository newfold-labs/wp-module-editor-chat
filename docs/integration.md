---
name: wp-module-editor-chat
title: Integration
description: How the module registers and integrates.
updated: 2026-10-22
---

# Integration

The module registers with the Newfold Module Loader via `bootstrap.php`. The host plugin mounts the editor chat UI in the Site Editor and block editor.

## Multi-brand behavior

Brand registry data is owned by **wp-module-onboarding** (`Brands::get_brands()`). On registration, onboarding populates the module loader container key **`editor_chat_brand`** (array: `id`, `name`, `accountUrl`, `emailUrl`, `billingUrl`, `adminUrl`, optional `icons`).

Editor-chat reads that payload through `NewfoldLabs\WP\Module\EditorChat\Data\BrandConfig` (no composer dependency on onboarding):

- **Brand id** — `get_editor_chat_brand_id()` (worker handshake).
- **Display name** — `get_current_brand_name()` (admin bar, sidebar).
- **Localized script** — `get_brand_for_editor_chat_js()` → `window.nfdEditorChat.brand`.

If the container key is missing, `BrandConfig` falls back to `container()->plugin()` id/name with empty portal URLs.

Host plugins must load onboarding before editor-chat enqueues scripts so `editor_chat_brand` is set.

### Filter: `newfold/container/editor_chat_brand`

Applied in onboarding when building the container value. Host plugins can adjust the full payload before other modules read it.

### Filter: `nfd_editor_chat_brand_links`

Expected `$links` keys: `accountUrl`, `emailUrl`, `billingUrl` (absolute HTTPS URLs). Values are passed through `esc_url()` when localized to JavaScript.

```php
add_filter(
	'nfd_editor_chat_brand_links',
	function ( $links, $brand_id ) {
		if ( 'my-brand' !== $brand_id ) {
			return $links;
		}

		return array(
			'accountUrl' => 'https://example.com/my-account',
			'emailUrl'   => 'https://example.com/email',
			'billingUrl' => 'https://example.com/billing',
		);
	},
	10,
	2
);
```

Host plugins can supply or override portal URLs when a brand is not in the built-in map.

### Brand icon overrides (`icons.avatar`, `icons.menu`)

The optional `icons` subarray lets a host plugin replace the default Bluehost 9-square mark used in two surfaces:

- `icons.avatar` — welcome screen avatar (`.nfd-editor-chat-welcome__avatar`), rendered via `AILogo`.
- `icons.menu` — header brand dropdown toggle icon (`.nfd-editor-chat__brand-menu__icon`), rendered via `BrandDropdownMenu`.

Both values are **absolute URLs** to image assets (SVG recommended) served by the host plugin, not raw markup. The React components render them as `<img>` elements with `alt=""` (the brand name is announced by the adjacent label) and explicit `width`/`height` to avoid layout shift. Unset keys fall back to the module's built-in defaults.

```php
add_filter(
	'newfold/container/editor_chat_brand',
	function ( $payload ) {
		$payload['icons'] = array(
			'avatar' => plugins_url( 'assets/svg/brand-avatar.svg', MY_PLUGIN_FILE ),
			'menu'   => plugins_url( 'assets/svg/brand-mark.svg',   MY_PLUGIN_FILE ),
		);
		return $payload;
	}
);
```

Recommended dimensions: avatar renders at up to 48×48 (component-controlled `width`/`height`), menu icon renders at 16×16 inside a 26×26 rounded-shadow container (`object-fit: contain`). Square assets with transparent backgrounds look best. SVG is preferred; PNG works but should be 2× the display size for HiDPI.

The field is treated as a trusted first-party URL from the module loader container (not end-user input); downstream `<img src>` cannot execute script regardless of scheme.

## UI components

- `BrandDropdownMenu` — header menu (formerly Bluehost-specific); CSS class prefix `nfd-editor-chat__brand-menu`.
- Sidebar title uses `sprintf( '%s AI Assistant', brand.name )`.

See [development.md](development.md) for local testing across brand plugins.

## Migrating from Bluehost-specific APIs

This release generalizes branding for all Newfold host plugins. Integrators that imported Bluehost-only symbols or targeted Bluehost CSS classes should update before **2.3.0**, when deprecated aliases are removed.

| Before | After |
|--------|--------|
| `BluehostDropdownMenu` | `BrandDropdownMenu` (deprecated alias export still available) |
| `nfd-editor-chat__bluehost-menu` | `nfd-editor-chat__brand-menu` |
| Hardcoded portal URLs in React | `window.nfdEditorChat.brand` or `nfd_editor_chat_brand_links` |

Full release notes: [changelog.md](changelog.md).
