import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface DegreeEntry {
  college: string
  degree: string
  macroTrack: number | null
  microTrack: number | null
}

let cache: DegreeEntry[] | null = null

export async function loadColleges(): Promise<DegreeEntry[]> {
  if (cache) return cache
  const path = join(process.cwd(), 'colleges.json')
  const raw = await readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as Array<{
    college: string
    degree: string
    credits1: number | null
    credits2: number | null
  }>
  cache = parsed.map((e) => ({
    college: e.college,
    degree: e.degree,
    macroTrack: e.credits1,
    microTrack: e.credits2,
  }))
  return cache
}

/**
 * Recommend degrees (majors/departments) to study given the user's interests.
 * This is exposed to the model as a callable function (recommend_study).
 */
export async function recommendStudy(input: {
  interest: string
  college?: string
}): Promise<{ degrees: DegreeEntry[]; summary: string }> {
  const all = await loadColleges()
  const interest = (input.interest ?? '').toLowerCase()

  let matches = all
  if (input.college) {
    const c = input.college.trim()
    matches = matches.filter((e) => e.college.includes(c))
  }

  // Rank by keyword overlap between interest text and degree name.
  const tokens = interest
    .split(/[\s,·&./()]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const scored = matches.map((entry) => {
    const hay = `${entry.degree} ${entry.college}`.toLowerCase()
    const score =
      tokens.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0) +
      (interest && hay.includes(interest) ? 2 : 0)
    return { entry, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const top = scored.filter((s) => s.score > 0).map((s) => s.entry)

  // Fall back to all departments if nothing matched (so the model can still
  // suggest from the full catalogue).
  const recommended = top.length > 0 ? top : matches

  const names = recommended
    .map((e) => {
      const macro = e.macroTrack != null ? `${e.macroTrack} credits (macro track)` : 'macro track: N/A'
      const micro = e.microTrack != null ? `${e.microTrack} credits (micro track)` : 'micro track: N/A'
      return `${e.degree} (${e.college}) — ${macro}, ${micro}`
    })
    .join('\n')
  return {
    degrees: recommended,
    summary:
      recommended.length > 0
        ? `Recommended degrees for "${input.interest}":\n${names}`
        : `No degrees matched "${input.interest}".`,
  }
}
