---
name: wp-module-editor-chat
title: Changelog
description: Notable changes by release.
updated: 2026-11-06
---

# Changelog

## Unreleased

### Added

- **Editor chat history.** Chats are stored in the custom table `{prefix}nfd_editor_chats` and exposed through `nfd-editor-chat/v1/conversations` (list, read, create, update, soft delete), scoped to the current user and site and limited to users who can edit pages. A history button in the editor toolbar, just before "New chat", lists previous chats (20 per page) and resumes or deletes them. See [conversation-history.md](conversation-history.md).
- Resuming a chat handles a deleted or trashed page (read-only note), a different page (open it or continue read-only) and a page edited since (drift banner), and adds a one-shot system note on the first turn so the model re-reads the current block tree.
- One-time migration of the legacy `localStorage` chat to the server (flag `nfd-editor-chat-migrated`).
- `window.nfdEditorChat.isEditor` (`"1"` or `""`) tells the UI whether the history button may be shown.

### Changed

- `localStorage` now only caches the open chat (24 hours) for reload recovery; the server table is the source of truth.

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

- `blu-editor/transform-block` accepts optional `attributes`, applied to the resulting block atomically.

### Fixed

- Removing a menu item did nothing. The `blu-editor/remove-block` fallback sent only `client_id` to `blu-delete-block`, which rejects bare client IDs inside a navigation ("Navigation menu deletes must use label"). The fallback now includes the item's `label` for `core/navigation-link` and `core/navigation-submenu`.

- Adding a page to the menu failed. `blu-editor/edit-block` and `blu-editor/update-block` checked the generic edit lock before the special-entity check, so a controlled `core/navigation` (edit-locked in the editor) produced a plain "cannot be edited" error instead of the typed fallback. The special-entity check now runs first.
- A navigation-link aimed at a `core/navigation` block through the `blu-edit-block` fallback is routed to `blu-insert-inner-block` (which resolves the page and checks it exists) instead of rewriting the whole navigation with one link.

- Asking to turn a paragraph into an H6 produced an H2: the transform could not carry a heading level. The model can now pass `attributes: { level: 6 }`.

- `blu-editor/insert-block` rejected string content for `rich-text` attributes (paragraph and heading `content`) inside nested `innerBlocks`. Attribute types declared as arrays are also accepted.
- `blu-editor/edit-block` could write a block Gutenberg flags as invalid ("Block contains unexpected or invalid content", for example a `core/button` missing `has-background`) because it used the model-written HTML as is. When the parser marks any block invalid, the tree is now rebuilt with `createBlock()` so the HTML matches `save()`, as the legacy `blu-edit-block` handler already did. Valid markup is untouched.
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
