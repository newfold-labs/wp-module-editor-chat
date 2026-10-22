---
name: wp-module-editor-chat
title: Integration
description: How the module registers and integrates.
updated: 2026-10-22
---

# Integration

The module registers with the Newfold Module Loader via `bootstrap.php`. The host plugin mounts the editor chat UI in the Site Editor and block editor.

## Multi-brand behavior

Brand data lives in **wp-module-onboarding** (`Brands::get_brands()`). Editor-chat reads it via `NewfoldLabs\WP\Module\Onboarding\Data\BrandConfig`:

- **Brand id** — `BrandConfig::get_editor_chat_brand_id()` (handshake `brand_id`; from registry `editorChatBrandId`).
- **Display name** — `BrandConfig::get_current_brand_name()` for admin bar and sidebar titles.
- **Portal links** — `accountUrl`, `emailUrl`, and `billingUrl` from the current brand registry entry, passed through `nfd_build_url`.

On enqueue, `ChatEditor` adds `brand` to `window.nfdEditorChat` via `BrandConfig::get_brand_for_editor_chat_js()`. React components must read these values instead of hardcoding "Bluehost".

**Composer:** `newfold-labs/wp-module-onboarding` is a required dependency. The host plugin must load onboarding (and call `Brands::set_current_brand()`) before editor-chat scripts enqueue.

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
