import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The canonical college catalogue, read directly from colleges.json (repo root)
 * on the Next.js server. This is the same source of truth the Python MCP server
 * loads, but surfaced here so the LLM can resolve a user's phrasing (in any
 * language) to the exact `degree` key the MCP tool expects.
 */

export interface CatalogueEntry {
  degree: string
  college: string
  url: string | null
  macroCredits: number | null
  microCredits: number | null
}

interface RawMeta {
  college: string
  url?: string
  credits1?: number | null
  credits2?: number | null
}

export function loadCatalogue(): CatalogueEntry[] {
  // Resolve from the repo root regardless of the Next.js cwd.
  const path = join(process.cwd(), 'colleges.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, RawMeta>
  return Object.entries(raw).map(([degree, meta]) => ({
    degree,
    college: meta.college,
    url: meta.url ?? null,
    macroCredits: meta.credits1 ?? null,
    microCredits: meta.credits2 ?? null,
  }))
}

/** Just the canonical degree names, used to seed the LLM resolution prompt. */
export function degreeNames(): string[] {
  return loadCatalogue().map((e) => e.degree)
}

/** Canonical degree names joined with their college, for context in the prompt. */
export function degreeCatalogueText(): string {
  return loadCatalogue()
    .map((e) => `${e.degree} — ${e.college}`)
    .join('\n')
}
