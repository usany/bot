# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "mcp[cli]",
#   "httpx",
#   "selectolax",
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
from pathlib import Path

import httpx
from selectolax.lexbor import LexborHTMLParser

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


# Boilerplate elements removed before text extraction. These are site chrome
# (navigation, footers, sidebars) that would otherwise drown out the actual
# department content.
_STRIP_SELECTOR = "script, style, noscript, nav, header, footer, aside, iframe, form"

# Content regions, in priority order. The KHU department sites all wrap their
# real page content in one of these containers, so preferring them keeps the
# nav menus out of the extracted text. We try each in turn and use the first
# that yields meaningful text.
_CONTENT_SELECTORS = [
    'article.sub_contents',          # che.khu.ac.kr and similar "view.do" pages
    'div.sub-page__content',         # hot.khu.ac.kr "view.do" pages
    'div.sub_contents_wrap',         # che.khu.ac.kr content wrapper
    'div.main-gallery',              # gukmun-type top-level department sites
    'div.main',                      # gukmun-type: main content wrapper
    'main',                          # generic <main> fallback
]

# Headings whose following text is most informative to a user asking about a
# department. We keep the full cleaned text too, but these let the LLM focus.
_USEFUL_HEADINGS = (
    "학과소개", "전공소개", "소개", "교육과정", "커리큘럼", "졸업요건",
    "졸업", "교과목", "진로", "취업", "교수", "학과장", "인사말",
    "about", "introduction", "curriculum", "overview",
)


def _node_text(node, max_len: int = 20000) -> str:
    """Extract clean, whitespace-normalized text from a selectolax node."""
    for junk in node.css(_STRIP_SELECTOR):
        junk.decompose()
    text = node.text(separator="\n", strip=True)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = _drop_artifact_lines(text)
    return text.strip()[:max_len]


def _drop_artifact_lines(text: str) -> str:
    """Remove lines that are clearly not prose (pasted CSS, URL blobs, etc.).

    Some department pages have raw CSS rules (``.class:before{...}``) or
    data-URI blobs pasted into their content editor as literal text. These
    lines are symbol-heavy with little to no Korean/English prose, so we drop
    them before returning.
    """
    out = []
    for line in text.split("\n"):
        s = line.strip()
        if not s:
            continue
        letters = len(re.findall(r"[\uac00-\ud7a3a-zA-Z]", s))
        # A line that is mostly punctuation/braces/CSS is not prose.
        if letters == 0 and len(s) <= 3:
            continue
        # CSS rule lines: start with a selector or contain balanced braces.
        if re.match(r"^[.#:]?[a-zA-Z_-][a-zA-Z0-9_-]*\s*\{", s) or (
            "{" in s and "}" in s and letters < 10 and "data:image" in s
        ):
            continue
        # Long data-URI / base64 blobs are never useful prose.
        if "data:image" in s and letters == 0:
            continue
        out.append(s)
    return "\n".join(out)


def _prose_score(text: str) -> float:
    """Score a text block by how much real prose (vs nav/list noise) it has.

    Real department descriptions are long sentences of Korean/English prose;
    navigation and sidebars are short fragments separated by line breaks. We
    reward long runs and sentence-like text, and penalize many tiny lines.
    """
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return 0.0
    total = len(text)
    avg_len = total / len(lines)
    # Count letters (Korean + Latin) as a proxy for prose density.
    letters = len(re.findall(r"[\uac00-\ud7a3a-zA-Z]", text))
    density = letters / max(total, 1)
    # Reward longer average line length and higher letter density.
    return avg_len * density * min(len(lines), 40)


def _extract_page_text(html: str, max_chars: int = 6000) -> str | None:
    """Parse a department homepage and return the meaningful text content.

    Strategy:
      1. Parse into a DOM (selectolax).
      2. Look for known KHU content containers and use the richest one.
      3. Fall back to scoring every block and picking the best prose block.
      4. Return the cleaned text, truncated to a bounded length.
    """
    if not html:
        return None
    parser = LexborHTMLParser(html)

    chosen = None
    # Pass 1: prefer known content containers.
    for selector in _CONTENT_SELECTORS:
        nodes = parser.css(selector)
        if not nodes:
            continue
        # Prefer the node with the highest prose score among matches.
        best = max(nodes, key=lambda n: _prose_score(_node_text(n, max_len=10**9)))
        text = _node_text(best)
        if len(text) >= 40:  # meaningful amount of prose
            chosen = text
            break

    # Pass 2: no known container matched — score all candidate blocks and keep
    # the single best prose block (avoids grabbing a whole-page wrapper).
    if chosen is None:
        candidates = []
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

    # If the cleaned text is still mostly navigation noise (very long), trim it
    # to a manageable, informative slice.
    return chosen[:max_chars]


def _looks_like_intro(text: str | None) -> bool:
    """Heuristic: does the extracted text read like a department introduction?

    We detect *news/announcement* content (the main false positive) and treat
    it as NOT an intro, forcing sub-page discovery. Real introductions describe
    the department (its purpose, curriculum, career paths) and are free of
    announcement markers like dates, "공지", "안내", "신청", "장학", etc.
    """
    if not text:
        return False
    head = text[:800]
    # Announcement/notice markers — if present, this is not an intro page.
    news_markers = (
        "공지", "안내", "신청", "접수", "장학", "선발", "모집",
        "더보기", "논문심사", "관련 근거", "학칙", "일정", "제출",
        "notice", "announcement", "deadline", "apply", "recruit",
    )
    if any(m in head for m in news_markers):
        return False
    # Intro markers — presence strongly suggests a real department intro.
    intro_markers = (
        "학과소개", "전공소개", "인사말", "환영", "소개합니다",
        "인사드립니다", "교육목적", "교육목표", "학과장", "진로",
        "교과과정", "교육과정", "졸업요건", "introduction", "welcome",
    )
    return any(m in head for m in intro_markers)


def _find_intro_link(html: str, base_url: str) -> str | None:
    """Find the link to the department's intro (학과소개/전공소개/인사말) page.

    Korean university sites put the department description on a dedicated
    ``view.do?menuNo=...`` page, not the homepage. We scan anchors whose text
    matches intro terms and return the first (absolute) URL that is not the
    homepage itself.
    """
    parser = LexborHTMLParser(html)
    base = httpx.URL(base_url)
    # Ordered by specificity — prefer the exact intro pages, fall back to
    # generic "소개". We skip the homepage URL to avoid bouncing back.
    intro_terms = ("학과소개", "전공소개", "학과장 인사", "인사말", "소개")
    for a in parser.css("a"):
        label = (a.text(strip=True) or "").strip()
        href = (a.attributes.get("href") or "").strip()
        if not href or href.startswith(("#", "javascript", "mailto", "tel")):
            continue
        if not any(t in label for t in intro_terms):
            continue
        resolved = base.join(href)
        # Skip the homepage / the page we are already on.
        if resolved.path.rstrip("/") == base.path.rstrip("/") and (
            not resolved.query
        ):
            continue
        return str(resolved)
    return None


def _find_section_links(html: str, base_url: str, terms) -> list[str]:
    """Find sub-page links whose anchor text matches any of `terms`.

    Used to locate curriculum/requirements/roadmap pages, which live on
    dedicated ``view.do?menuNo=...`` / ``list.do?menuNo=...`` sub-pages rather
    than the homepage. Returns absolute URLs, de-duplicated, in DOM order.
    """
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


def _decode_html(content: bytes, charset_hint: str | None = None) -> str:
    """Decode an HTML response with correct charset detection.

    Korean university sites are often ``ks_c_5601-1987`` (a.k.a. CP949/EUC-KR)
    while their HTTP headers omit the charset, so ``httpx`` defaults to UTF-8
    and mojibake results. We sniff the ``<meta charset>`` tag from the raw
    bytes and re-decode with the right codec.
    """
    codec = "utf-8"
    if charset_hint:
        codec = charset_hint
    # Look for encoding declared in the HTML meta tag.
    m = re.search(
        rb"<meta[^>]+charset=[\"']?([a-zA-Z0-9_\-]+)", content[:4096], re.I
    )
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
    """Extract a JS ``location.href`` redirect target, if present.

    Some legacy pages (e.g. old Microsoft Word-saved HTML) redirect via
    ``<script>location.href="..."</script>`` rather than HTTP 3xx, which
    httpx cannot follow. Return the resolved absolute URL or None.
    """
    m = re.search(
        r"location\.(?:href|replace)\s*=\s*[\"']([^\"']+)[\"']", html
    )
    if not m:
        return None
    target = m.group(1)
    # If the target is already absolute, return it unchanged; otherwise
    # resolve it against the base URL.
    if re.match(r"^https?://", target, re.I):
        return target
    return str(httpx.URL(base_url).join(target))


def _fetch_page(url: str, max_chars: int = 6000) -> str | None:
    """Fetch a URL (following redirects) and return bounded, readable text.

    Strategy:
      1. Fetch the given URL, decode with proper charset detection, and
         extract its main prose.
      2. If the page is a JS redirect stub, follow the ``location.href``
         target and re-fetch.
      3. If the result does not look like a department introduction (the
         homepage may be dominated by a news board), discover the
         ``학과소개/전공소개`` sub-page and fetch that instead.

    Uses httpx for proper redirect/gzip handling. A browser-like User-Agent
    avoids the lightweight bot-blocking some Korean dept sites use.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ko,en;q=0.8",
    }
    # verify=False mirrors the previous behaviour: some environments lack the
    # local CA bundle and fail CERTIFICATE_VERIFY_FAILED for valid HTTPS sites.
    # The fetched text is treated as untrusted input by the caller anyway.
    with httpx.Client(
        timeout=15.0, follow_redirects=True, verify=False, headers=headers
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        charset_hint = None
        if resp.headers.get("content-type"):
            cm = re.search(
                r"charset=([a-zA-Z0-9_\-]+)",
                resp.headers["content-type"],
                re.I,
            )
            if cm:
                charset_hint = cm.group(1)
        html = _decode_html(resp.content, charset_hint)

        # Follow a JS redirect if the page is just a stub.
        js_target = _js_redirect_url(html, str(resp.url))
        if js_target and js_target != str(resp.url):
            resp = client.get(js_target)
            resp.raise_for_status()
            html = _decode_html(resp.content, charset_hint)

        text = _extract_page_text(html, max_chars=max_chars)

        # If the homepage didn't give us an intro, follow the intro link.
        if not _looks_like_intro(text):
            intro_url = _find_intro_link(html, str(resp.url))
            if intro_url and intro_url != str(resp.url):
                try:
                    intro_resp = client.get(intro_url)
                    intro_resp.raise_for_status()
                    intro_text = _extract_page_text(
                        intro_resp.text, max_chars=max_chars
                    )
                    if intro_text:
                        return intro_text
                except Exception:  # noqa: BLE001 — homepage text is a fine fallback
                    pass
        return text


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


# Anchor-label terms that point at the pages a student asking about a
# department's *curriculum* would want (course lists, roadmap, requirements).
_CURRICULUM_TERMS = (
    "교육과정", "교과과정", "교과목", "이수체계", "커리큘럼", "교과",
    "졸업요건", "졸업이수", "이수학점", "시행세칙", "curriculum", "courses",
)


def _fetch_curriculum(degree: str) -> str:
    """Fetch the curriculum-related pages for a degree and return their text.

    Strategy: resolve the degree, fetch its homepage, discover the
    ``교육과정/교과과정/이수체계/졸업요건`` links, then fetch each (up to a few)
    and concatenate the extracted prose. Falls back to the homepage intro if no
    curriculum links are found.
    """
    entry = _find_degree(degree)
    if entry is None:
        return f"No degree matched {degree!r}. Try a name like 수학과 or 국어국문학과."

    url = entry["url"]
    header = f"{entry['degree']} ({entry['college']})\nHomepage: {url}"
    if not url:
        return f"{header}\n(No homepage URL is available for this degree.)"

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
        "Accept-Language": "ko,en;q=0.8",
    }
    with httpx.Client(
        timeout=15.0, follow_redirects=True, verify=False, headers=headers
    ) as client:
        try:
            home = client.get(url)
            home.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            return f"{header}\n\nCould not fetch the homepage ({exc})."

        home_html = _decode_html(home.content)
        links = _find_section_links(home_html, str(home.url), _CURRICULUM_TERMS)

        # Fetch each curriculum link, collecting non-empty prose.
        parts: list[str] = []
        for link in links[:5]:
            try:
                r = client.get(link)
                r.raise_for_status()
                text = _extract_page_text(_decode_html(r.content), max_chars=4000)
                if text:
                    parts.append(text)
            except Exception:  # noqa: BLE001
                continue

    if not parts:
        # No curriculum sub-pages discovered — fall back to the homepage intro.
        return get_degree_details(degree)

    body = "\n\n---\n\n".join(parts)
    return f"{header}\n\n[Curriculum / courses]\n\n{body}"


@mcp.tool()
def get_degree_curriculum(degree: str) -> str:
    """Fetch a degree's curriculum (courses, roadmap, graduation requirements).

    Call this when the user asks specifically about a department's curriculum,
    courses, 교과과정, 교육과정, 이수체계, or 졸업요건 (what subjects they study
    year-by-year, required credits, course lists). This differs from
    `get_degree_details`, which returns the department's general introduction.

    Pass the degree name as `degree`, in any language (e.g. "수학과", "math",
    "mathematics", "국어국문학과"). The tool finds the department's
    curriculum/education sub-pages and returns their content.
    """
    return _fetch_curriculum(degree)


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=3100)
