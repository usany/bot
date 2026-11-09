import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The canonical college catalogue, read directly from colleges.json (repo root)
 * on the Next.js server. This is the same source of truth the Python MCP server
 * loads, but surfaced here so the LLM can resolve a user's phrasing (in any
 * language) to the exact `degree` key the MCP tool expects.
 *
 * The same file also carries the crawled timetable under `offerings`, so a
 * single read gives both the degree metadata and the current semester's
 * lectures.
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
  offerings?: LectureOfferings
}

/** Module-qualified `fieldGb` code -> names, from `offerings.fieldGbLegend`. */
export interface FieldGbLabel {
  ko: string
  en: string
}

export interface Lecture {
  subjectCd: string
  name: string
  credits: number | null
  fieldGb: string
  campus: string
  note: string | null
}

export interface OfferedDepartment {
  name: string
  code: string
  level: number | null
  catalogue: string | null
  lectureCount: number
  lectures: Lecture[]
}

export interface OfferedCollege {
  college: string
  collegeKo: string
  collegeCd: string
  lectureCount: number
  departments: OfferedDepartment[]
}

/** The crawled semester timetable (`scripts/crawl-lectures.ts`). */
export interface LectureOfferings {
  source: string
  year: number
  term: number
  termCode: string
  semester: string
  fetchedAt: string
  fieldGbLegend: Record<string, FieldGbLabel>
  colleges: OfferedCollege[]
}

/**
 * Load and cache the catalogue. `colleges.json` is the single source of truth
 * for departments plus their English/synonym aliases and per-college aliases.
 */
let _cache: {
  entries: CatalogueEntry[]
  collegeAliases: Record<string, string[]>
  offerings: LectureOfferings | null
} | null = null

function rawCatalogue(): {
  entries: CatalogueEntry[]
  collegeAliases: Record<string, string[]>
  offerings: LectureOfferings | null
} {
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
  _cache = {
    entries,
    collegeAliases: raw.collegeAliases ?? {},
    offerings: raw.offerings ?? null,
  }
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
 * The semester timetable merged into colleges.json, or null when it has not
 * been crawled yet. `fieldGb` labels live in `offerings.fieldGbLegend`.
 */
export function loadOfferings(): LectureOfferings | null {
  return rawCatalogue().offerings
}

/** Lectures for one degree, matched on the catalogue key (`catalogue` field). */
export function lecturesForDegree(degree: string): Lecture[] {
  const offerings = loadOfferings()
  if (!offerings) return []
  return offerings.colleges.flatMap((college) =>
    college.departments
      .filter((dept) => dept.catalogue === degree)
      .flatMap((dept) => dept.lectures),
  )
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
