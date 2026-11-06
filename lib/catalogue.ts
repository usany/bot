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
  aliases: string[]
}

interface RawMeta {
  college: string
  url?: string
  credits1?: number | null
  credits2?: number | null
  aliases?: string[]
}

interface RawCatalogue {
  collegeAliases?: Record<string, string[]>
  departments?: Record<string, RawMeta>
}

/**
 * Load and cache the catalogue. `colleges.json` is the single source of truth
 * for departments plus their English/synonym aliases and per-college aliases.
 */
let _cache: { entries: CatalogueEntry[]; collegeAliases: Record<string, string[]> } | null =
  null

function rawCatalogue(): { entries: CatalogueEntry[]; collegeAliases: Record<string, string[]> } {
  if (_cache) return _cache
  const path = join(process.cwd(), 'colleges.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as RawCatalogue
  const departments = raw.departments ?? {}
  const entries: CatalogueEntry[] = Object.entries(departments).map(([degree, meta]) => ({
    degree,
    college: meta.college,
    url: meta.url ?? null,
    macroCredits: meta.credits1 ?? null,
    microCredits: meta.credits2 ?? null,
    aliases: meta.aliases ?? [],
  }))
  _cache = { entries, collegeAliases: raw.collegeAliases ?? {} }
  return _cache
}

export function loadCatalogue(): CatalogueEntry[] {
  return rawCatalogue().entries
}

/** College name -> aliases, from the shared colleges.json. */
export function collegeAliases(): Record<string, string[]> {
  return rawCatalogue().collegeAliases
}

/**
 * Degree lines with their aliases, so the classifier can resolve synonyms in
 * any language (e.g. "math" -> "수학과") directly from the shared data source.
 */
export function degreeAliasText(): string {
  return loadCatalogue()
    .map((e) => {
      const aliasLine = e.aliases.length ? ` (aliases: ${e.aliases.join(', ')})` : ''
      return `${e.degree} — ${e.college}${aliasLine}`
    })
    .join('\n')
}
