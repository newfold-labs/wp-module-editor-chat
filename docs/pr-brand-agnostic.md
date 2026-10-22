# Pull request: Make editor-chat brand-agnostic

Use this as the GitHub PR body (English).

## Summary

- Consume `Onboarding\Data\BrandConfig` and the `Brands` registry (composer dependency on wp-module-onboarding); `nfd_editor_chat_brand_links` filter remains on onboarding.
- Expose `brand` on `window.nfdEditorChat` for React (header dropdown, sidebar title, admin bar).
- Rename Bluehost-specific UI (`BrandDropdownMenu`, `BrandIcon`, `__brand-menu` styles).

## Why

Editor chat ships inside HostGator, Web.com, and other brand plugins; UI and handshake `brand_id` must follow the host container.

## Test plan

- [ ] `composer run test` — `BrandConfigWPUnitTest`.
- [ ] `npm run build` — commit updated `build/<version>/` assets.
- [ ] Bluehost: Site Editor header menu shows correct name; portal links work; admin bar title uses brand name.
- [ ] Worker handshake still sends `brand_id` from `BrandConfig::get_brand_id()`.

## Docs

- [docs/integration.md](integration.md) — Multi-brand behavior and filter.
- [docs/development.md](development.md) — cross-brand local testing.

## Breaking changes / deprecation

- Prefer `BrandDropdownMenu`; `BluehostDropdownMenu` remains as a deprecated alias until **2.3.0** (see [changelog.md](changelog.md)).
- CSS class prefix `nfd-editor-chat__brand-menu` replaces `nfd-editor-chat__bluehost-menu`; legacy selectors ship in built CSS for one release cycle.
