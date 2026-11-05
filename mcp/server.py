# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "mcp[cli]",
#   "httpx",
#   "selectolax",
# ]
# ///

"""Reusable college-catalogue MCP server.

Run it (no venv, no requirements.txt — ``uv`` resolves the inline deps above):

    uv run mcp/server.py

It serves a Streamable HTTP endpoint at http://127.0.0.1:3100/mcp exposing a
small set of *generic*, schema-typed tools that any MCP client (Claude Desktop,
Cursor, this Next.js app, a CLI, a test harness) can discover via ``listTools``
and call dynamically.

Design intent: these are **data tools**, not policy tools. The server returns
structured facts (catalogue entries, scraped page text); it does not decide what
"recommendation" means. Clients are free to rank, filter, or present results
however they like.

Tools:

    get_catalogue      — the full structured catalogue (one object per department).
    search_catalogue   — fuzzy-match departments by interest/college (any language).
    get_department     — fetch a department's live homepage intro (structured).
    get_curriculum     — fetch a department's curriculum/courses pages (structured).
    fetch_text         — generic web-page text extraction (any URL).

Every tool declares typed input/output schemas, so a client can introspect the
tool surface without out-of-band knowledge of name or argument shape.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Annotated, Any

import httpx
from selectolax.lexbor import LexborHTMLParser

from mcp.server import MCPServer

mcp = MCPServer(
    name="kyunghee-catalogue",
    instructions=(
        "A college catalogue and department-homepage tool for Kyung Hee "
        "University. Call `get_catalogue` first to discover departments; use "
        "`search_catalogue` to match a user's interest; use `get_department` / "
        "`get_curriculum` to fetch live pages; use `fetch_text` for any URL."
    ),
)

COLLEGES_PATH = Path(__file__).resolve().parent.parent / "colleges.json"

# English (and common) aliases for each degree so queries like "math",
# "mathematics", "physics", or "English literature" resolve to the
# corresponding Korean department. Keys are normalized to lowercase.
_DEGREE_ALIASES: dict[str, list[str]] = {
    "국어국문학과": ["korean language and literature", "korean literature", "korean"],
    "영어영문학과": ["english language and literature", "english literature", "english"],
    "응용영어통번역학과": ["applied english interpretation and translation", "translation", "interpreting"],
    "사학과": ["history"],
    "철학과": ["philosophy"],
    "정치외교학과": ["political science", "international relations", "politics"],
    "행정학과": ["public administration", "administration"],
    "사회학과": ["sociology"],
    "미디어학과": ["media", "media studies", "communication"],
    "경제학과": ["economics"],
    "무역학과": ["trade", "international trade"],
    "국제통상․금융투자학부": ["international commerce", "finance", "investment"],
    "경영학과": ["business administration", "business", "management"],
    "회계·세무학과": ["accounting", "taxation", "accounting and tax"],
    "빅데이터응용학과": ["big data", "data science", "big data application"],
    "Hospitality경영학과": ["hospitality management", "hospitality"],
    "조리&푸드디자인학과": ["culinary", "food design", "culinary arts"],
    "관광학과": ["tourism", "tourism management"],
    "문화엔터테인먼트학과": ["culture and entertainment", "entertainment"],
    "수학과": ["mathematics", "math", "maths"],
    "물리학과": ["physics"],
    "화학과": ["chemistry"],
    "생물학과": ["biology", "biological sciences"],
    "지리학과": ["geography"],
    "정보디스플레이학과": ["information display", "display"],
    "소재·발광소자학": ["materials", "light emitting devices"],
    "구동소자·시스템학": ["device systems", "driving devices"],
    "아동가족학과": ["child and family studies", "child development"],
    "주거환경학과": ["housing and interior", "residential environment"],
    "의상학과": ["fashion", "clothing and textiles", "fashion design"],
    "식품영양학과": ["food and nutrition", "nutrition"],
}

# English aliases for colleges.
_COLLEGE_ALIASES: dict[str, list[str]] = {
    "문과대학": ["liberal arts", "humanities", "college of liberal arts"],
    "정경대학": ["college of politics and economics", "politics and economics", "social sciences"],
    "경영대학": ["business school", "college of business", "college of business administration"],
    "호텔관광대학": ["hotel and tourism", "tourism college", "hospitality"],
    "이과대학": ["college of science", "college of natural sciences", "science"],
    "생활과학대학": ["college of human ecology", "human ecology", "living science"],
}


# ---------------------------------------------------------------------------
# Catalogue data model (structured, so clients can rely on a stable shape).
# ---------------------------------------------------------------------------

def _norm(s: str) -> str:
    """Lowercase, strip, and collapse whitespace for matching."""
    return re.sub(r"\s+", " ", (s or "").lower().strip())


def _aliases_for(entry: dict) -> list[str]:
    """All searchable aliases (English + Korean) for a catalogue entry."""
    names = [entry["degree"], entry["college"]]
    names += _DEGREE_ALIASES.get(entry["degree"], [])
    names += _COLLEGE_ALIASES.get(entry["college"], [])
    return names


def _load_entries() -> list[dict]:
    """Return the catalogue as a list of stable dicts (one per department)."""
    data = json.loads(COLLEGES_PATH.read_text(encoding="utf-8"))
    entries: list[dict] = []
    for degree, meta in data.items():
        entries.append(
            {
                "degree": degree,
                "college": meta["college"],
                "url": meta.get("url"),
                "macro_credits": meta.get("credits1"),
                "micro_credits": meta.get("credits2"),
                "aliases": _DEGREE_ALIASES.get(degree, []),
            }
        )
    return entries


def _public_entry(e: dict) -> dict:
    """Project an entry to a stable, JSON-safe, client-facing shape."""
    return {
        "degree": e["degree"],
        "college": e["college"],
        "url": e.get("url"),
        "macro_credits": e.get("macro_credits"),
        "micro_credits": e.get("micro_credits"),
    }


def _find_degree(degree: str) -> dict | None:
    """Return the catalogue entry whose name or alias matches `degree`."""
    target = _norm(degree)
    if not target:
        return None

    entries = _load_entries()
    for suffix in (
        " department", " dept", " major", " department of",
        "학과", "학부", "전공",
    ):
        if target.endswith(suffix):
            target = target[: -len(suffix)].strip()

    # 1) Exact match on Korean name or alias.
    for e in entries:
        if _norm(e["degree"]) == target:
            return e
        if target in [_norm(a) for a in _DEGREE_ALIASES.get(e["degree"], [])]:
            return e

    # 2) Substring match on Korean name.
    for e in entries:
        if target in _norm(e["degree"]):
            return e

    # 3) Substring match on aliases.
    for e in entries:
        for alias in _DEGREE_ALIASES.get(e["degree"], []):
            if target in alias or alias in target:
                return e

    # 4) Token overlap.
    targets = set(target.split())
    for e in entries:
        for alias in _DEGREE_ALIASES.get(e["degree"], []):
            if targets & set(alias.split()):
                return e

    return None


# ---------------------------------------------------------------------------
# Web scraping (charset detection, content extraction, sub-page discovery).
# This is the genuinely reusable part — it is URL-agnostic, not KHU-specific.
# ---------------------------------------------------------------------------

_STRIP_SELECTOR = "script, style, noscript, nav, header, footer, aside, iframe, form"

_CONTENT_SELECTORS = [
    'article.sub_contents',
    'div.sub-page__content',
    'div.sub_contents_wrap',
    'div.main-gallery',
    'div.main',
    'main',
]


def _node_text(node, max_len: int = 20000) -> str:
    for junk in node.css(_STRIP_SELECTOR):
        junk.decompose()
    text = node.text(separator="\n", strip=True)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return _drop_artifact_lines(text).strip()[:max_len]


def _drop_artifact_lines(text: str) -> str:
    out: list[str] = []
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            continue
        letters = len(re.findall(r"[\uac00-\ud7a3a-zA-Z]", s))
        if letters == 0 and len(s) <= 3:
            continue
        if re.match(r"^[.#:]?[a-zA-Z_-][a-zA-Z0-9_-]*\s*\{", s) or (
            "{" in s and "}" in s and letters < 10 and "data:image" in s
        ):
            continue
        if "data:image" in s and letters == 0:
            continue
        out.append(s)
    return "\n".join(out)


def _prose_score(text: str) -> float:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return 0.0
    total = len(text)
    avg_len = total / len(lines)
    letters = len(re.findall(r"[\uac00-\ud7a3a-zA-Z]", text))
    density = letters / max(total, 1)
    return avg_len * density * min(len(lines), 40)


def _extract_page_text(html: str, max_chars: int = 6000) -> str | None:
    if not html:
        return None
    parser = LexborHTMLParser(html)

    chosen: str | None = None
    for selector in _CONTENT_SELECTORS:
        nodes = parser.css(selector)
        if not nodes:
            continue
        best = max(nodes, key=lambda n: _prose_score(_node_text(n, max_len=10**9)))
        text = _node_text(best)
        if len(text) >= 40:
            chosen = text
            break

    if chosen is None:
        candidates: list[tuple[float, str]] = []
        for n in parser.css("div, article, section, main"):
            txt = _node_text(n, max_len=10**9)
            if len(txt) < 40:
                continue
            candidates.append((_prose_score(txt), txt))
        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            chosen = candidates[0][1]

    if chosen is None:
        body = parser.body
        if body is None:
            return None
        chosen = _node_text(body)

    return chosen[:max_chars]


def _decode_html(content: bytes, charset_hint: str | None = None) -> str:
    codec = "utf-8"
    if charset_hint:
        codec = charset_hint
    m = re.search(rb"<meta[^>]+charset=[\"']?([a-zA-Z0-9_\-]+)", content[:4096], re.I)
    if m:
        declared = m.group(1).decode("ascii", "ignore").lower()
        if declared in ("ks_c_5601-1987", "ksc5601", "euc-kr", "cp949", "ms949"):
            codec = "cp949"
        elif declared in ("utf-8", "utf8"):
            codec = "utf-8"
        elif declared in ("iso-8859-1", "latin1", "latin-1"):
            codec = "latin-1"
        else:
            codec = declared
    try:
        return content.decode(codec, errors="replace")
    except LookupError:
        return content.decode("utf-8", errors="replace")


def _js_redirect_url(html: str, base_url: str) -> str | None:
    m = re.search(r"location\.(?:href|replace)\s*=\s*[\"']([^\"']+)[\"']", html)
    if not m:
        return None
    target = m.group(1)
    if re.match(r"^https?://", target, re.I):
        return target
    return str(httpx.URL(base_url).join(target))


def _fetch_page(url: str, max_chars: int = 6000) -> str | None:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko,en;q=0.8",
    }
    with httpx.Client(timeout=15.0, follow_redirects=True, verify=False, headers=headers) as client:
        resp = client.get(url)
        resp.raise_for_status()
        charset_hint = None
        if resp.headers.get("content-type"):
            cm = re.search(r"charset=([a-zA-Z0-9_\-]+)", resp.headers["content-type"], re.I)
            if cm:
                charset_hint = cm.group(1)
        html = _decode_html(resp.content, charset_hint)

        js_target = _js_redirect_url(html, str(resp.url))
        if js_target and js_target != str(resp.url):
            resp = client.get(js_target)
            resp.raise_for_status()
            html = _decode_html(resp.content, charset_hint)

        return _extract_page_text(html, max_chars=max_chars)


# ---------------------------------------------------------------------------
# Discovery helpers (used by get_department / get_curriculum).
# ---------------------------------------------------------------------------

_USEFUL_INTRO_MARKERS = (
    "학과소개", "전공소개", "인사말", "환영", "소개합니다", "인사드립니다",
    "교육목적", "교육목표", "학과장", "진로", "교과과정", "교육과정",
    "졸업요건", "introduction", "welcome",
)

_NEWS_MARKERS = (
    "공지", "안내", "신청", "접수", "장학", "선발", "모집", "더보기",
    "논문심사", "관련 근거", "학칙", "일정", "제출", "notice",
    "announcement", "deadline", "apply", "recruit",
)


def _looks_like_intro(text: str | None) -> bool:
    if not text:
        return False
    head = text[:800]
    if any(m in head for m in _NEWS_MARKERS):
        return False
    return any(m in head for m in _USEFUL_INTRO_MARKERS)


def _find_intro_link(html: str, base_url: str) -> str | None:
    parser = LexborHTMLParser(html)
    base = httpx.URL(base_url)
    intro_terms = ("학과소개", "전공소개", "학과장 인사", "인사말", "소개")
    for a in parser.css("a"):
        label = (a.text(strip=True) or "").strip()
        href = (a.attributes.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript", "mailto", "tel")):
            continue
        if not any(t in label for t in intro_terms):
            continue
        resolved = base.join(href)
        if resolved.path.rstrip("/") == base.path.rstrip("/") and not resolved.query:
            continue
        return str(resolved)
    return None


def _find_section_links(html: str, base_url: str, terms) -> list[str]:
    parser = LexborHTMLParser(html)
    base = httpx.URL(base_url)
    found: list[str] = []
    seen: set[str] = set()
    for a in parser.css("a"):
        label = (a.text(strip=True) or "").strip()
        href = (a.attributes.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript", "mailto", "tel")):
            continue
        if not any(t in label for t in terms):
            continue
        resolved = str(base.join(href))
        if resolved not in seen:
            seen.add(resolved)
            found.append(resolved)
    return found


_CURRICULUM_TERMS = (
    "교육과정", "교과과정", "교과목", "이수체계", "커리큘럼", "교과",
    "졸업요건", "졸업이수", "이수학점", "시행세칙", "curriculum", "courses",
)


def _fetch_department_text(url: str, max_chars: int = 6000) -> str | None:
    """Fetch a department homepage, following the intro sub-page if needed."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept-Language": "ko,en;q=0.8",
    }
    with httpx.Client(timeout=15.0, follow_redirects=True, verify=False, headers=headers) as client:
        resp = client.get(url)
        resp.raise_for_status()
        html = _decode_html(resp.content)
        text = _extract_page_text(html, max_chars=max_chars)
        if not _looks_like_intro(text):
            intro_url = _find_intro_link(html, str(resp.url))
            if intro_url and intro_url != str(resp.url):
                try:
                    intro_resp = client.get(intro_url)
                    intro_resp.raise_for_status()
                    intro_text = _extract_page_text(
                        _decode_html(intro_resp.content), max_chars=max_chars
                    )
                    if intro_text:
                        return intro_text
                except Exception:  # noqa: BLE001
                    pass
        return text


# ---------------------------------------------------------------------------
# Tools. Note: `structured_output=True` + return type annotations expose the
# tool's output schema to clients via `listTools`, making these reusable.
# ---------------------------------------------------------------------------


@mcp.tool(
    title="Get full college catalogue",
    structured_output=True,
    description=(
        "Return the full, structured college catalogue: every department with "
        "its college, homepage URL, and credit requirements. Call this first to "
        "discover what departments exist. The response is a JSON array of "
        "{degree, college, url, macro_credits, micro_credits} objects."
    ),
)
def get_catalogue() -> list[dict[str, Any]]:
    """Return all departments as a JSON array of stable objects."""
    return [_public_entry(e) for e in _load_entries()]


@mcp.tool(
    title="Search catalogue by interest",
    structured_output=True,
    description=(
        "Fuzzy-match departments against a free-text interest (any language) and "
        "optionally restrict to a college. Returns a JSON array of matching "
        "{degree, college, url, macro_credits, micro_credits} objects, best "
        "match first. This is a search tool: it returns ranked facts, not prose."
    ),
)
def search_catalogue(
    interest: Annotated[str, "The user's interest or field, in any language (e.g. 'mathematics', '수학', 'finance')."],
    college: Annotated[str, "Optional college filter, any language (e.g. '이과대학', 'college of science')."] = "",
) -> list[dict[str, Any]]:
    """Return departments ranked by relevance to `interest`."""
    interest_n = _norm(interest)
    college_n = _norm(college)
    entries = _load_entries()

    if college_n:
        def college_matches(e: dict) -> bool:
            names = [e["college"]] + _COLLEGE_ALIASES.get(e["college"], [])
            return any(college_n in _norm(n) or _norm(n) in college_n for n in names)
        entries = [e for e in entries if college_matches(e)]

    tokens = [t for t in interest_n.split() if t]

    def score(e: dict) -> int:
        names = [f"{e['degree']} {e['college']}"] + _aliases_for(e)
        s = 0
        for name in names:
            n = _norm(name)
            s += sum(1 for t in tokens if t in n)
            if interest_n and interest_n in n:
                s += 2
        return s

    ranked = sorted(entries, key=score, reverse=True)
    top = [e for e in ranked if score(e) > 0]
    result = top if top else entries
    return [_public_entry(e) for e in result]


@mcp.tool(
    title="Get department homepage introduction",
    structured_output=True,
    description=(
        "Resolve a degree name (any language) to a department and fetch its live "
        "homepage introduction. Returns a JSON object {degree, college, url, text} "
        "where text is the cleaned page content (may be empty if fetch failed)."
    ),
)
def get_department(
    degree: Annotated[str, "Degree/department name, any language (e.g. '수학과', 'math', 'mathematics')."],
) -> dict[str, Any]:
    """Fetch a department's homepage intro as a structured object."""
    entry = _find_degree(degree)
    if entry is None:
        return {
            "degree": None,
            "college": None,
            "url": None,
            "text": f"No degree matched {degree!r}.",
            "error": "not_found",
        }

    url = entry["url"]
    base = {
        "degree": entry["degree"],
        "college": entry["college"],
        "url": url,
    }
    if not url:
        return {**base, "text": "", "error": "no_url"}
    try:
        text = _fetch_department_text(url)
    except Exception as exc:  # noqa: BLE001
        return {**base, "text": "", "error": f"fetch_failed: {exc}"}
    return {**base, "text": text or "", "error": None}


@mcp.tool(
    title="Get department curriculum",
    structured_output=True,
    description=(
        "Resolve a degree name and fetch its curriculum/courses/graduation-"
        "requirement pages. Returns a JSON object {degree, college, url, text, "
        "pages} where pages is a list of the sub-page URLs used."
    ),
)
def get_curriculum(
    degree: Annotated[str, "Degree/department name, any language."],
) -> dict[str, Any]:
    """Fetch a department's curriculum pages as a structured object."""
    entry = _find_degree(degree)
    if entry is None:
        return {"degree": None, "college": None, "url": None, "text": f"No degree matched {degree!r}.", "pages": [], "error": "not_found"}

    url = entry["url"]
    base = {"degree": entry["degree"], "college": entry["college"], "url": url}
    if not url:
        return {**base, "text": "", "pages": [], "error": "no_url"}

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept-Language": "ko,en;q=0.8",
    }
    parts: list[str] = []
    pages: list[str] = []
    with httpx.Client(timeout=15.0, follow_redirects=True, verify=False, headers=headers) as client:
        try:
            home = client.get(url)
            home.raise_for_status()
            home_html = _decode_html(home.content)
            links = _find_section_links(home_html, str(home.url), _CURRICULUM_TERMS)
            for link in links[:5]:
                try:
                    r = client.get(link)
                    r.raise_for_status()
                    text = _extract_page_text(_decode_html(r.content), max_chars=4000)
                    if text:
                        parts.append(text)
                        pages.append(link)
                except Exception:  # noqa: BLE001
                    continue
        except Exception as exc:  # noqa: BLE001
            return {**base, "text": "", "pages": [], "error": f"fetch_failed: {exc}"}

    if not parts:
        # Fall back to the homepage intro.
        try:
            intro = _fetch_department_text(url)
        except Exception:  # noqa: BLE001
            intro = None
        return {**base, "text": intro or "", "pages": pages, "error": None}

    return {**base, "text": "\n\n---\n\n".join(parts), "pages": pages, "error": None}


@mcp.tool(
    title="Fetch web page text (generic)",
    structured_output=True,
    description=(
        "Fetch any http(s) URL and return its cleaned, readable text. This is a "
        "generic web-extraction tool, not specific to Kyung Hee. Returns a JSON "
        "object {url, text} (text may be empty if extraction failed)."
    ),
)
def fetch_text(
    url: Annotated[str, "A full http(s) URL to fetch."],
) -> dict[str, str]:
    """Fetch arbitrary URL text as a structured object."""
    u = (url or "").strip()
    if not u:
        return {"url": u, "text": ""}
    if not (u.startswith("http://") or u.startswith("https://")):
        return {"url": u, "text": f"Unsupported URL scheme: {u!r}."}
    try:
        text = _fetch_page(u)
    except Exception as exc:  # noqa: BLE001
        return {"url": u, "text": f"Could not fetch {u} ({exc})."}
    return {"url": u, "text": text or ""}


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=3100)
