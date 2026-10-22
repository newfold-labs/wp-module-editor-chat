---
name: wp-module-editor-chat
title: Development
description: Lint, test, and workflow.
updated: 2025-03-18
---

# Development

PHP: `composer run lint`, `composer run clean`. When cutting a release, update **docs/changelog.md**.

## Composer dependency on wp-module-onboarding

Brand data is read from onboarding. For local development, link the sibling repo before `composer install`:

```bash
ln -sf ../wp-module-onboarding onboarding-dep
composer install
```

CI checks out `newfold-labs/wp-module-onboarding` into `onboarding-dep` automatically.

## Testing on non-Bluehost brand plugins

1. Clone the target brand plugin and symlink `vendor/newfold-labs/wp-module-editor-chat` to your working copy (same as Bluehost local dev).
2. Open the Site Editor with `referrer=nfd-editor-chat` or use the admin bar **AI Editor** link.
3. Confirm `window.nfdEditorChat.brand.name` matches the host plugin and portal menu items use the correct URLs (or add values via `nfd_editor_chat_brand_links`).

```bash
npm install
npm run build   # updates build/<version>/chat-editor.js
composer run test
```
