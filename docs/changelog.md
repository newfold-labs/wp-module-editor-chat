---
name: wp-module-editor-chat
title: Changelog
description: Notable changes by release.
updated: 2026-10-22
---

# Changelog

## 2.1.11 (unreleased)

### Added

- Brand registry remains in **wp-module-onboarding**; onboarding sets container key `editor_chat_brand`. Editor-chat reads it via `Data\BrandConfig` without a composer dependency on onboarding.
- `window.nfdEditorChat.brand` — localized payload (`id`, `name`, `accountUrl`, `emailUrl`, `billingUrl`, `adminUrl`) for React UI.
- Filter `nfd_editor_chat_brand_links` — override portal URLs per brand plugin id (see [integration.md](integration.md)).

### Changed

- Header customer menu and styles are brand-agnostic (`BrandDropdownMenu`, `nfd-editor-chat__brand-menu`).
- Admin bar and sidebar titles use the host plugin display name instead of hardcoded "Bluehost".
- Worker handshake `brand_id` uses `BrandConfig::get_editor_chat_brand_id()` from onboarding.

### Deprecated (remove in 2.3.0)

- **`BluehostDropdownMenu`** — import `BrandDropdownMenu` from the header components barrel instead. A deprecated alias export remains for one minor release cycle.
- **CSS classes** `nfd-editor-chat__bluehost-menu`, `nfd-editor-chat__bluehost-menu__icon`, `nfd-editor-chat__bluehost-menu__chevron` — update custom CSS to `nfd-editor-chat__brand-menu` and matching BEM children. Legacy selectors are still emitted in built CSS until removal.

### Migration

**JavaScript / TypeScript**

```diff
- import { BluehostDropdownMenu } from '…/header/components';
+ import { BrandDropdownMenu } from '…/header/components';
```

**Custom CSS**

```diff
- .nfd-editor-chat__bluehost-menu .components-button { … }
+ .nfd-editor-chat__brand-menu .components-button { … }
```

**Host plugins with custom portal URLs**

```php
add_filter(
	'nfd_editor_chat_brand_links',
	function ( $links, $brand_id ) {
		// Return accountUrl, emailUrl, billingUrl for your brand id.
		return $links;
	},
	10,
	2
);
```
