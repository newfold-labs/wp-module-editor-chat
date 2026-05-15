# Agent guidance – wp-module-editor-chat

This file gives AI agents a quick orientation to the repo. For full detail, see the **docs/** directory.

## What this project is

- **wp-module-editor-chat** – Site Editor AI Chat. Registers with the Newfold Module Loader. Maintained by Newfold Labs.

- **Stack:** PHP 7.3+. See composer.json for dependencies.

- **Architecture:** Registers with the loader; provides AI chat in the site editor. See docs/integration.md.

## Key paths

| Purpose | Location |
|---------|----------|
| Bootstrap | `bootstrap.php` |
| Includes | `includes/` |

## Essential commands

```bash
composer install
composer run lint
composer run clean
```

## Documentation

- **Full documentation** is in **docs/**. Start with **docs/index.md**.
- **CLAUDE.md** is a symlink to this file (AGENTS.md).

---

## Keeping documentation current

When you change code, features, or workflows, update the docs. Keep **docs/index.md** current: when you add, remove, or rename doc files, update the table of contents (and quick links if present). When cutting a release, update **docs/changelog.md**.
