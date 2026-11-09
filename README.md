# Chat Assistant

A Next.js chat UI backed by Groq (via the OpenAI SDK), with degree
recommendations served by a separate Python MCP server.

```
Browser ──▶ Next.js /api/chat ──▶ Groq
                         │
                         └──▶ MCP client ──▶ Python MCP server (recommend_study)
                                                  └──▶ colleges.json (+ offerings)
```

The browser only talks to the Next.js API routes. The model is reached
server-side (`lib/openai.ts`), so the API key never reaches the browser.
Degree recommendations are exposed as an MCP **tool** (not OpenAI
function-calling): the Next.js server is an MCP *client* that calls the Python
server over Streamable HTTP.

## Development

```sh
pnpm install
```

Start the MCP server (uses `uv`, no venv, no requirements.txt — dependencies
are declared inline in `mcp/server.py`):

```sh
uv run mcp/server.py      # serves http://127.0.0.1:3001/mcp
```

Start the app:

```sh
pnpm dev                  # runs `next dev`
```

## Production

```sh
uv run mcp/server.py
pnpm build
pnpm start
```

Set `GROQ_KEY` (and optionally `GROQ_MODEL`), plus `MCP_SERVER_URL`, in `.env`.

## Study recommendations

When the user asks what to study (e.g. "what should I study?", "recommend a
major"), the chat calls the `recommend_study` MCP tool (`mcp/server.py`), which
matches the user's interest against `colleges.json` and returns ranked
departments with their credit requirements. The Next.js server feeds that
result to the model as system context so it can answer in natural language.

## Lecture timetable (`offerings` in `colleges.json`)

`scripts/crawl-lectures.ts` pulls the course timetable from the Kyung Hee
registration system (`https://sugang.khu.ac.kr`, 종합시간표 조회) for the
colleges in `colleges.json` and merges it into `colleges.json` under the
top-level `offerings` key. There is no separate timetable file.

```sh
pnpm crawl:lectures                       # current + previous semester
pnpm crawl:lectures --term 20             # only the current year's 2학기
pnpm crawl:lectures --previous            # the two semesters before the current one
node scripts/crawl-lectures.ts --year 2026 --term 20
node scripts/crawl-lectures.ts --out offerings-2026-1.json   # scratch file
```

Without `--term` the run crawls the **current semester and the previous one**,
keyed by term code. The current semester is resolved in Seoul time: 1학기 is
Mar–Aug (`10`), 2학기 is Sep–Dec (`20`), and Jan–Feb still counts as the previous
year's 2학기. So the default run during 2026-2학기 fetches `202620` + `202610`,
and during 2026-1학기 fetches `202610` + `202520`.

Pass `--term` to crawl a single semester instead: `10` (1학기), `20` (2학기),
`15` (여름계절) or `25` (겨울계절) — combined with `--year` for a past year.

`--previous` (or `-p`) steps each target one semester back — 1학기 becomes the
previous year's 2학기, 2학기 becomes the same year's 1학기:

| given | previous |
| --- | --- |
| 2026 1학기 (`10`) | 2025 2학기 (`20`) |
| 2026 2학기 (`20`) | 2026 1학기 (`10`) |
| 2026 여름계절 (`15`) | 2026 1학기 (`10`) |
| 2026 겨울계절 (`25`) | 2026 2학기 (`20`) |

With the default (two semesters) it shifts both, so during 2026-2학기
`--previous` covers `202610` + `202520`. It composes with `--year`/`--term`
(`--year 2026 --term 10 --previous` → 2025-2).

Merge semantics: `offerings` is keyed by term code, so a run replaces only the
semesters it crawled and keeps any other semester already in the file. If one of
the two default semesters has no published data yet (e.g. next year's 1학기), it
is reported and skipped rather than failing the whole run.

The merge is textual: only the trailing `offerings` member is rewritten, so the
hand-curated `departments` section keeps its formatting.
`lib/catalogue.ts` exposes the result through `loadOfferings()` (map by term
code), `latestOfferings()` and `lecturesForDegree(degree, termCode?)`.

When a user asks which lectures a department offers ("what lectures does the
Big Data department have?"), the chat calls the `get_lectures` MCP tool
(`mcp/server.py`) — a read of the `offerings` data, not a website scrape — and
answers with the course list, translating Korean course titles to English when
the user writes in English.

What it does:

1. `GET /` → `/login?attribute=loginFrame` → `/core?attribute=coreLectureList`
   opens the same search form a browser gets when clicking the
   `onclick="fnLoad(urlCoreLectureList,'this')"` menu item. The `#p_daehak`
   (college) options come from `/resources/data/data_<year>.js`, which the
   script evaluates directly.
2. For each college in `colleges.json`, it reads that college's departments
   (`dh` = college code) from the same data file — a college code on its own
   returns no rows, lectures are keyed by department code.
3. Each department is queried through
   `/core?attribute=lectListJson&...&p_major=<code>`. The site only allows one
   such call per session, so every query opens a fresh session.
4. Departments are matched back to `colleges.json` names (`catalogue`); names
   the site has since renamed are handled by `RENAMES`, and anything still
   unmatched is reported as `! not offered this term`.

`colleges.json` shape:

```jsonc
{
  "departments": {
    "경제학과": { "college": "정경대학", "url": "https://econ.khu.ac.kr",
                 "credits1": 39, "credits2": 21 }
  },
  "offerings": {
    "202610": { "source": "...", "year": 2026, "term": 10, "termCode": "202610",
                "semester": "2026-1학기", "fetchedAt": "...",
                "fieldGbLegend": {...}, "colleges": [...] },
    "202620": {
      "source": "https://sugang.khu.ac.kr/core?attribute=lectListJson",
      "year": 2026, "term": 20, "termCode": "202620",
      "semester": "2026-2학기", "fetchedAt": "2026-11-09T09:47:02.986Z",
      "fieldGbLegend": { "05": { "ko": "전공선택", "en": "Elective Major Studies" } },
      "colleges": [
        { "college": "College of Politics & Economics", "collegeKo": "정경대학",
          "collegeCd": "A00422", "lectureCount": 202,
          "departments": [
            { "name": "경제학과 경제학", "code": "A00430", "catalogue": "경제학과",
              "lectureCount": 39,
              "lectures": [
                { "subjectCd": "ECON3064", "name": "부동산경제분석",
                  "credits": 3, "fieldGb": "05", "campus": "서울", "note": null }
              ] }
          ] }
      ]
    }
  }
}
```

`fieldGb` codes are expanded in `offerings.fieldGbLegend` (Korean + English).
