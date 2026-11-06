# Chat Assistant

A Next.js chat UI backed by Groq (via the OpenAI SDK), with degree
recommendations served by a separate Python MCP server.

```
Browser ──▶ Next.js /api/chat ──▶ Groq
                         │
                         └──▶ MCP client ──▶ Python MCP server (recommend_study)
                                                  └──▶ colleges.json
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

## Lecture timetable (`lectures.json`)

`scripts/crawl-lectures.mjs` pulls the course timetable from the Kyung Hee
registration system (`https://sugang.khu.ac.kr`, 종합시간표 조회) for the
colleges in `colleges.json` and writes `lectures.json` at the repo root.

```sh
pnpm crawl:lectures                       # current semester
node scripts/crawl-lectures.mjs --year 2026 --term 20
node scripts/crawl-lectures.mjs --out lectures-2026-1.json
```

`--term` is `10` (1학기), `20` (2학기), `15` (여름계절) or `25` (겨울계절).

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

Output shape:

```jsonc
{
  "year": 2026, "term": 20, "semester": "2026-2학기",
  "colleges": [
    { "college": "College of Politics & Economics", "collegeKo": "정경대학",
      "collegeCd": "A00422", "lectureCount": 202,
      "departments": [
        { "name": "경제학과 경제학", "code": "A00430", "catalogue": "경제학과",
          "lectureCount": 39,
          "lectures": [
            { "lectureCd": "ECON306400", "lectureCdDisp": "ECON3064-00",
              "name": "부동산경제분석", "professor": "민인식", "credits": 3,
              "grade": 3, "timetable": "월 12:00-13:15 (정301) / ...",
              "fieldGb": "05", "campus": "서울", "capacity": 78,
              "applied": 77, "remaining": 1, "note": null }
          ] }
      ] }
  ]
}
```

`fieldGb` codes are expanded in `fieldGbLegend`.
