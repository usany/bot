<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Auto-commit

Automatically commit your changes with the `auto-commit` skill after every
file change. Stage and commit directly with git — no scripts or watchers:

```bash
git add -A
git commit -m "<prefix>: <short description>"
```

Respect `.gitignore` (never force-add `.env` or secrets), use an appropriate
conventional-commit prefix (`feat:`, `fix:`, `docs:`, `style:`, `refactor:`,
`chore:`, `wip:`) matching the change, and prefer a work branch over `main`
for auto-commits. See `.claude/skills/auto-commit/SKILL.md` for details.

Commit directly and do **not** ask for permission or confirmation before
committing.

# Brand Colors

Use the `brand-colors` skill whenever asked to change styling, colors, theming,
or branding. Read `.claude/skills/brand-colors/SKILL.md` and apply the official
brand palette (Crimson, Blue, Gold, Cool Gray, Silver) with their exact HEX/RGB
values.
