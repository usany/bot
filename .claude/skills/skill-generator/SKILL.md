---
name: skill-generator
description: Create and scaffold new agent skills (SKILL.md packages). Use when the user asks to build, generate, scaffold, or write a new skill, capability package, or reusable agent workflow/instruction set.
---

# Skill Generator

Guide for creating high-quality, spec-compliant agent skills. Skills are
self-contained capability packages discovered by the agent via a `SKILL.md`
file with frontmatter, plus optional scripts and reference docs.

## When to use

Trigger this skill when the user requests a new skill, asks to scaffold a
skill, or wants to turn a repeated workflow into a reusable package.

## The anatomy of a skill

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Optional helper scripts
├── references/           # Optional docs loaded on-demand
└── assets/               # Optional templates/data files
```

## Step-by-step

1. **Pick a name.** Lowercase `a-z`, `0-9`, hyphens only; 1-64 chars; no
   leading/trailing or consecutive hyphens. e.g. `pdf-processing`,
   `code-review`. Prefer a verb-ish or domain-specific name.

2. **Write the description.** This is the single most important field — it
   determines *when* the agent loads the skill. Max 1024 chars. State what the
   skill does and, crucially, **when to use it**. Good:
   `description: Extracts text and tables from PDF files and fills PDF forms. Use when working with PDF documents.`
   Poor: `description: Helps with PDFs.`

3. **Write the body.** Begin with an H1 title. Break into sections: When to
   use, Setup (any one-time install), Usage (commands), and any reference
   pointers. Use relative paths to reference bundled files.

4. **Add helper scripts** under `scripts/` when the workflow needs
   deterministic logic (fetching, parsing, file transforms). Keep them
   self-contained and document invocation in the main SKILL.md.

5. **Add reference docs** under `references/` for detail that should load
   on-demand rather than always (large API references, checklists, examples).

## Frontmatter reference

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | lowercase, hyphens, 1-64 chars |
| `description` | Yes | what + when-to-use, max 1024 chars |
| `license` | No | license name or bundled file |
| `compatibility` | No | environment requirements, max 500 chars |
| `metadata` | No | arbitrary key-value map |
| `allowed-tools` | No | space-delimited pre-approved tools |
| `disable-model-invocation` | No | `true` hides from system prompt |

## Output format

When asked to generate a skill, produce the directory under the requested
skills location (e.g. `.claude/skills/` or `.pi/skills/`) with:

- `SKILL.md` (frontmatter + instructions)
- `scripts/`, `references/`, `assets/` only if the skill actually benefits
  from them (do not add empty scaffolding).

## Validation checklist

- [ ] `name` is lowercase, hyphen-separated, 1-64 chars, no invalid chars
- [ ] `description` is non-empty and states *when to use* the skill
- [ ] Body starts with an H1 and uses relative paths to bundled files
- [ ] No empty directories were created

## Example

See the Agent Skills specification at https://agentskills.io/specification
for the canonical template and field details.
