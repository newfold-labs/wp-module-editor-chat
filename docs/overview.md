---
name: wp-module-editor-chat
title: Overview
description: What the module does and who maintains it.
updated: 2025-03-18
---

# Overview

**wp-module-editor-chat** provides Site Editor AI Chat for Newfold brand plugins. It registers with the Newfold Module Loader. Maintained by Newfold Labs. Distributed via Newfold Satis.

## Features

- **Design editing** — Update page sections, styles, layout, and content in the Site Editor via conversational AI.
- **Content creation (v1)** — Create new pages, posts, and CPTs as drafts from the chat. Pages open in the Site Editor preview; posts open in the block editor (`post.php`) with the chat sidebar available on the left.
- **MCP integration** — Site management actions use wp-module-mcp abilities via the MCP gateway (`blu-list-abilities`, `blu-get-ability-schema`, `blu-call-ability`).
- **Intent classification** — User messages are classified by the CF Worker (`POST /classify-intent`) before each turn to route between page editing, content creation, and site management — multilingual and synonym-safe.

See [changelog.md](changelog.md) for release notes.
