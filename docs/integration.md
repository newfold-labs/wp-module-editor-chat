---
name: wp-module-editor-chat
title: Integration
description: How the module registers and integrates.
updated: 2026-10-22
---

# Integration

The module registers with the Newfold Module Loader via `bootstrap.php`. The host plugin mounts the editor chat UI in the Site Editor and block editor.

## Multi-brand behavior

`includes/Data/BrandConfig.php` resolves:

- **Brand id** — `container()->plugin()->id` (handshake `brand_id`, same pattern as `wp-module-ai-chat` `BrandHelper`).
- **Display name** — `container()->plugin()->name` for admin bar and sidebar titles.
- **Portal links** — default account, email, and billing URLs per known brand plugin id, passed through `nfd_build_url`.

On enqueue, `ChatEditor` adds `brand` to `window.nfdEditorChat` (id, name, accountUrl, emailUrl, billingUrl, adminUrl). React components must read these values instead of hardcoding "Bluehost".

### Filter: `nfd_editor_chat_brand_links`

```php
apply_filters( 'nfd_editor_chat_brand_links', $links, $brand_id );
```

Host plugins can supply or override portal URLs when a brand is not in the built-in map.

## UI components

- `BrandDropdownMenu` — header menu (formerly Bluehost-specific); CSS class prefix `nfd-editor-chat__brand-menu`.
- Sidebar title uses `sprintf( '%s AI Assistant', brand.name )`.

See [development.md](development.md) for local testing across brand plugins.
