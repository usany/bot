import 'server-only'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The canonical college catalogue, read directly from mcp/colleges.json
 * on the Next.js server. This is the same source of truth the Python MCP server
 * loads, but surfaced here so the LLM can resolve a user's phrasing (in any
 * language) to the exact `degree` key the MCP tool expects.
 *
 * Language resolution is the LLM's job: the file stores only the canonical
 * Korean names, and the classifier translates the user's wording to those keys.
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
}

interface RawMeta {
  college: string
  url?: string
  credits1?: number | null
  credits2?: number | null
}

interface RawCatalogue {
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

/** One crawled semester (`scripts/crawl-lectures.ts`). */
export interface SemesterOfferings {
  source: string
  year: number
  term: number
  termCode: string
  semester: string
  fetchedAt: string
  fieldGbLegend: Record<string, FieldGbLabel>
  colleges: OfferedCollege[]
}

/** `offerings` in colleges.json: crawled semesters keyed by term code. */
export type LectureOfferings = Record<string, SemesterOfferings>

/**
 * Load and cache the catalogue. `colleges.json` is the single source of truth
 * for departments (canonical Korean names) plus the crawled timetable.
 */
let _cache: {
  entries: CatalogueEntry[]
  offerings: LectureOfferings
} | null = null

function rawCatalogue(): {
  entries: CatalogueEntry[]
  offerings: LectureOfferings
} {
  if (_cache) return _cache
  const path = join(process.cwd(), 'mcp', 'colleges.json')
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as RawCatalogue
  const departments = raw.departments ?? {}
  const entries: CatalogueEntry[] = Object.entries(departments).map(([degree, meta]) => ({
    degree,
    college: meta.college,
    url: meta.url ?? null,
    macroCredits: meta.credits1 ?? null,
    microCredits: meta.credits2 ?? null,
  }))
  _cache = {
    entries,
    offerings: raw.offerings ?? {},
  }
  return _cache
}

export function loadCatalogue(): CatalogueEntry[] {
  return rawCatalogue().entries
}

/**
 * The timetables merged into colleges.json, keyed by term code ("202610",
 * "202620"). Empty when nothing has been crawled yet.
 */
export function loadOfferings(): LectureOfferings {
  return rawCatalogue().offerings
}

/** Newest crawled semester (highest term code), or null. */
export function latestOfferings(): SemesterOfferings | null {
  const codes = Object.keys(loadOfferings()).sort()
  const code = codes.at(-1)
  return code ? loadOfferings()[code] : null
}

/**
 * Degrees whose courses the registrar publishes under a single merged
 * department, so the crawled row has `catalogue: null`. Maps a canonical
 * degree to the merged department's registration code.
 */
const MERGED_DEPARTMENT_CODES: Record<string, readonly string[]> = {
  '소재·발광소자학': ['A11136'], // merged into 미래정보디스플레이학부
  '구동소자·시스템학': ['A11136'],
}

/**
 * Lectures for one degree, matched on the catalogue key (`catalogue` field),
 * in the given semester or the newest crawled one.
 */
export function lecturesForDegree(degree: string, termCode?: string): Lecture[] {
  const semester = termCode ? loadOfferings()[termCode] : latestOfferings()
  if (!semester) return []
  const mergedCodes = MERGED_DEPARTMENT_CODES[degree] ?? []
  return semester.colleges.flatMap((college) =>
    college.departments
      .filter(
        (dept) =>
          dept.catalogue === degree ||
          (dept.code != null && mergedCodes.includes(dept.code)),
      )
      .flatMap((dept) => dept.lectures),
  )
}

/**
 * Degree lines for the classifier, so it can resolve synonyms in any language
 * directly from the shared data source. The classifier translates the user's
 * wording to the canonical Korean `degree` (the text before " — ").
 */
export function catalogueText(): string {
  return loadCatalogue()
    .map((e) => `${e.degree} — ${e.college}`)
    .join('\n')
}