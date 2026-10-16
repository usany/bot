import 'server-only'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface CollegeEntry {
  college: string
  degree: string
  credits1: number | null
  credits2: number | null
}

let cache: CollegeEntry[] | null = null

export async function loadColleges(): Promise<CollegeEntry[]> {
  if (cache) return cache
  const path = join(process.cwd(), 'colleges.json')
  const raw = await readFile(path, 'utf8')
  cache = JSON.parse(raw) as CollegeEntry[]
  return cache
}

/**
 * Recommend departments to study given the user's interests.
 * This is exposed to the model as a callable function (recommend_study).
 */
export async function recommendStudy(input: {
  interest: string
  college?: string
}): Promise<{ colleges: CollegeEntry[]; summary: string }> {
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

  const names = recommended.map((e) => `${e.degree} (${e.college})`).join(', ')
  return {
    colleges: recommended,
    summary:
      recommended.length > 0
        ? `Recommended departments for "${input.interest}": ${names}`
        : `No departments matched "${input.interest}".`,
  }
}
