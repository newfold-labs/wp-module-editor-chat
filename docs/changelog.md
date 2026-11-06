---
name: wp-module-editor-chat
title: Changelog
description: Notable changes by release.
updated: 2026-11-06
---

# Changelog

## 2.1.12 (unreleased)

### Added

- Brand registry remains in **wp-module-onboarding**; onboarding sets container key `editor_chat_brand`. Editor-chat reads it via `Data\BrandConfig` without a composer dependency on onboarding.
- `window.nfdEditorChat.brand` — localized payload (`id`, `name`, `accountUrl`, `emailUrl`, `billingUrl`, `adminUrl`) for React UI.
- Filter `nfd_editor_chat_brand_links` — override portal URLs per brand plugin id (see [integration.md](integration.md)).

### Changed

- Header customer menu and styles are brand-agnostic (`BrandDropdownMenu`, `nfd-editor-chat__brand-menu`).
- Admin bar and sidebar titles use the host plugin display name instead of hardcoded "Bluehost".
- Worker handshake `brand_id` uses `BrandConfig::get_editor_chat_brand_id()` from onboarding.
- Editor Chat no longer offers `blu-editor_insert-block` to the model. Section and content creation (text plus images) goes through the server `blu-add-section` ability. The ability stays registered for other consumers. A model call to the invented name `blu-editor_add-section` is routed to `blu-add-section`. See [editor-abilities.md](editor-abilities.md#editor-chat-routing).
- The no-progress guard (`MAX_READ_ONLY_PASSES`) no longer counts gateway discovery passes (`blu-list-abilities`, `blu-get-ability-schema`).

### Fixed

- `blu-editor/insert-block` rejected string content for `rich-text` attributes (paragraph and heading `content`) inside nested `innerBlocks`. Attribute types declared as arrays are also accepted.
- Local WebMCP tool errors were reported as success. The WebMCP polyfill resolves `executeTool` with a JSON string, so `isError` and `structuredContent` were lost and a failed write showed "Applied successfully". `runLocalTool` now parses the serialized result.
- Requests that read an uploaded document (for example a CSV) and then add a section stopped with "No-progress loop" before the write, because gateway discovery consumed the read-only pass budget.

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
