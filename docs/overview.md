---
name: wp-module-editor-chat
title: Overview
description: What the module does and who maintains it.
updated: 2026-08-19
---

# Overview

**wp-module-editor-chat** provides Site Editor AI Chat for Newfold brand plugins. It registers with the Newfold Module Loader. Maintained by Newfold Labs. Distributed via Newfold Satis.

## Features

- **Design editing** — Update page sections, styles, layout, and content in the Site Editor via conversational AI.
- **Content creation (v1)** — Create new pages, posts, and CPTs as drafts from the chat. Pages open in the Site Editor preview; posts open in the block editor (`post.php`) with the chat sidebar available on the left. Block markup in `content` is validated and normalized client-side (same pipeline as `blu-add-section`) before the MCP create/update call. New **pages** default to a rich layout: mixed sections (cover hero, `media-text`, `columns`), color-band groups (`align:full` + constrained inner content) vs flow groups at content width, theme palette slugs, generated images. The intent classifier sets `layout` to `text_only` when the user asks for a plain textual page (any language/synonyms); that skips the richness check. Thin or all-full-bleed page markup is rejected so the model can retry.
- **MCP integration** — Site management actions use wp-module-mcp abilities via the MCP gateway (`blu-list-abilities`, `blu-get-ability-schema`, `blu-call-ability`).
- **Intent classification** — User messages are classified by the CF Worker (`POST /classify-intent`) before each turn to route between page editing, content creation, and site management — multilingual and synonym-safe. Navigation menu add/remove requests are detected in the same call (`menu_edit`). Page-creation layout (`layout`: `rich` | `text_only`) is classified there too so a plain-text page request is not inferred with regex.

See [changelog.md](changelog.md) for release notes.
