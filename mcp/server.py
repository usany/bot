# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "mcp[cli]",
# ]
# ///

"""Degree-recommendation MCP server.

Run it (no venv, no requirements.txt — `uv` resolves the inline deps above):

    uv run mcp/server.py

It serves a Streamable HTTP endpoint at http://127.0.0.1:3100/mcp exposing a
single tool, `recommend_study`, which reads ``colleges.json`` and ranks majors
against the caller's interest.
"""

import json
import re
import ssl
import urllib.request
from html import unescape
from pathlib import Path

from mcp.server import MCPServer

mcp = MCPServer("colleges")

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


# English aliases for colleges so queries like "college of science" or
# "liberal arts" resolve to 이과대학 / 문과대학 respectively.
_COLLEGE_ALIASES: dict[str, list[str]] = {
    "문과대학": ["liberal arts", "humanities", "college of liberal arts"],
    "정경대학": ["college of politics and economics", "politics and economics", "social sciences"],
    "경영대학": ["business school", "college of business", "college of business administration"],
    "호텔관광대학": ["hotel and tourism", "tourism college", "hospitality"],
    "이과대학": ["college of science", "college of natural sciences", "science"],
    "생활과학대학": ["college of human ecology", "human ecology", "living science"],
}


def _norm(s: str) -> str:
    """Lowercase, strip, and collapse whitespace for matching."""
    return re.sub(r"\s+", " ", (s or "").lower().strip())


def _aliases_for(entry: dict) -> list[str]:
    """All searchable aliases (English + Korean) for a catalogue entry."""
    names = [entry["degree"], entry["college"]]
    names += _DEGREE_ALIASES.get(entry["degree"], [])
    names += _COLLEGE_ALIASES.get(entry["college"], [])
    return names


def _load_colleges() -> list[dict]:
    data = json.loads(COLLEGES_PATH.read_text(encoding="utf-8"))
    entries = []
    for degree, meta in data.items():
        entries.append(
            {
                "degree": degree,
                "college": meta["college"],
                "url": meta.get("url"),
                "macro_credits": meta.get("credits1"),
                "micro_credits": meta.get("credits2"),
            }
        )
    return entries


def _find_degree(degree: str) -> dict | None:
    """Return the catalogue entry whose name or alias matches `degree`.

    Matching is case-insensitive and works against both the Korean degree name
    and its English aliases, so queries like "math department" or "physics"
    resolve to 수학과 / 물리학과 respectively.
    """
    target = _norm(degree)
    if not target:
        return None

    entries = _load_colleges()
    # Strip trailing words like "department", "major", "과" is handled below.
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

    # 3) Substring match on aliases (e.g. "math" inside "mathematics").
    for e in entries:
        for alias in _DEGREE_ALIASES.get(e["degree"], []):
            if target in alias or alias in target:
                return e

    # 4) Token overlap (e.g. "applied math" vs "mathematics").
    targets = set(target.split())
    for e in entries:
        for alias in _DEGREE_ALIASES.get(e["degree"], []):
            atoks = set(alias.split())
            if targets & atoks:
                return e

    return None


def _strip_html(raw: str) -> str:
    """Very small HTML-to-text helper for extracting readable detail."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"[ \t\r\n]+", " ", text).strip()
    return text


def _fetch_page(url: str, max_chars: int = 6000) -> str | None:
    """Fetch a URL and return a bounded, readable text slice."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; colleges-bot/1.0)",
            "Accept-Language": "ko,en;q=0.8",
        },
    )
    # Some environments (e.g. Windows) lack the local CA bundle that Python's
    # ssl defaults to, causing CERTIFICATE_VERIFY_FAILED for valid HTTPS sites.
    # Relax to unverified for this local browsing tool; the caller treats any
    # fetch as untrusted text anyway.
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        body = resp.read().decode(charset, errors="replace")
    text = _strip_html(body)
    # Drop blank-heavy boilerplate; keep a bounded, informative slice.
    return text[:max_chars]


def _fetch_degree_page(url: str) -> str | None:
    """Fetch a degree homepage and return a short readable description."""
    return _fetch_page(url)

@mcp.tool()
def recommend_study(interest: str, college: str = "") -> str:
    """Recommend a degree (major/department) to study from the college catalogue.

    Call this when the user asks what to study, for a degree/major recommendation,
    or which department matches their interest. Provide the user's interest/field
    as `interest`, and optionally restrict results to a college via `college`.

    `interest` and `college` may be in ANY language (e.g. Korean, English).
    Translate the user's intent into the most specific term you can (e.g.
    "mathematics" or "수학" for the math major, "physics" or "물리" for physics).
    The tool matches against Korean names and their English aliases.

    Note: this tool is invoked on every chat turn, so it may be called for
    unrelated conversations. When the user's message has no connection to a
    study/degree recommendation, respond briefly and stay on their actual topic
    rather than forcing a recommendation.
    """
    interest = _norm(interest)
    college_filter = _norm(college)

    entries = _load_colleges()
    if college_filter:
        def college_matches(e: dict) -> bool:
            names = [e["college"]] + _COLLEGE_ALIASES.get(e["college"], [])
            return any(college_filter in _norm(n) or _norm(n) in college_filter for n in names)
        entries = [e for e in entries if college_matches(e)]

    tokens = [t for t in interest.split() if t]

    def score(e: dict) -> int:
        names = [f"{e['degree']} {e['college']}"] + _aliases_for(e)
        s = 0
        for name in names:
            n = _norm(name)
            s += sum(1 for t in tokens if t in n)
            if interest and interest in n:
                s += 2
        return s

    ranked = sorted(entries, key=score, reverse=True)
    top = [e for e in ranked if score(e) > 0]
    recommended = top if top else entries

    if not recommended:
        return f"No degrees matched {interest or '(nothing)'!r}."

    lines = [f"Recommended degrees for {interest or '(no interest)'!r}:"]
    for e in recommended:
        macro = (
            f"{e['macro_credits']} credits (macro track)"
            if e["macro_credits"] is not None
            else "macro track: N/A"
        )
        micro = (
            f"{e['micro_credits']} credits (micro track)"
            if e["micro_credits"] is not None
            else "micro track: N/A"
        )
        lines.append(f"- {e['degree']} ({e['college']}) — {macro}, {micro}")
    return "\n".join(lines)


@mcp.tool()
def browse_url(url: str) -> str:
    """Fetch a web page by URL and return its readable text content.

    Use this to browse the web when the user asks to retrieve or read content
    from a specific URL (e.g. an article, a department page, a webpage they
    pasted). Pass the full http(s) URL as `url`. The result is the page's text
    with HTML stripped, truncated to a bounded length so it fits in context.
    """
    url = (url or "").strip()
    if not url:
        return "No URL provided."
    if not (url.startswith("http://") or url.startswith("https://")):
        return f"Unsupported URL scheme: {url!r}. Provide a full http(s) URL."
    try:
        text = _fetch_page(url)
    except Exception as exc:  # noqa: BLE001
        return f"Could not fetch {url} ({exc})."
    if not text:
        return f"{url} returned no readable content."
    return f"Content from {url}:\n\n{text}"


@mcp.tool()
def get_degree_details(degree: str) -> str:
    """Fetch detailed information about a specific degree (major/department).

    Call this when the user asks for details about a particular degree, such as
    its curriculum, introduction, admissions requirements, or what it studies.

    Pass the degree name as `degree`. It may be in ANY language: use the Korean
    name (e.g. "국어국문학과", "수학과") or an English name (e.g. "mathematics",
    "math department", "physics"). The tool resolves English names to the
    matching Korean department and fetches its official homepage for details.
    """
    entry = _find_degree(degree)
    if entry is None:
        return f"No degree matched {degree!r}. Try a name like 국어국문학과 or 경영학과."

    url = entry["url"]
    header = f"{entry['degree']} ({entry['college']})\nHomepage: {url}"
    if not url:
        return f"{header}\n(No homepage URL is available for this degree.)"

    try:
        text = _fetch_degree_page(url)
    except Exception as exc:  # noqa: BLE001 — surface any fetch error to the caller
        return (
            f"{header}\n\n"
            f"Could not fetch the homepage ({exc}). The official page is at "
            f"{url} — please open it directly for details."
        )

    if not text:
        return f"{header}\n\nThe page returned no readable content. See {url}."

    return f"{header}\n\n{text}"


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=3100)
