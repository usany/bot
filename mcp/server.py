# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "mcp[cli]",
# ]
# ///

"""Degree-recommendation MCP server.

Run it (no venv, no requirements.txt — `uv` resolves the inline deps above):

    uv run mcp/server.py

It serves a Streamable HTTP endpoint at http://127.0.0.1:3001/mcp exposing a
single tool, `recommend_study`, which reads ``colleges.json`` and ranks majors
against the caller's interest.
"""

import json
import re
import urllib.request
from html import unescape
from pathlib import Path

from mcp.server import MCPServer

mcp = MCPServer("colleges")

COLLEGES_PATH = Path(__file__).resolve().parent.parent / "colleges.json"


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
    """Return the catalogue entry whose degree name matches `degree`."""
    target = (degree or "").strip()
    for e in _load_colleges():
        if e["degree"] == target:
            return e
        if target and target in e["degree"]:
            return e
    return None


def _strip_html(raw: str) -> str:
    """Very small HTML-to-text helper for extracting readable detail."""
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    text = re.sub(r"[ \t\r\n]+", " ", text).strip()
    return text


def _fetch_degree_page(url: str) -> str | None:
    """Fetch a degree homepage and return a short readable description."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; colleges-bot/1.0)",
            "Accept-Language": "ko,en;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        body = resp.read().decode(charset, errors="replace")
    text = _strip_html(body)
    # Drop blank-heavy boilerplate; keep a bounded, informative slice.
    return text[:6000]


@mcp.tool()
def recommend_study(interest: str, college: str = "") -> str:
    """Recommend a degree (major/department) to study from the college catalogue.

    Call this when the user asks what to study, for a degree/major recommendation,
    or which department matches their interest. Provide the user's interest/field
    as `interest`, and optionally restrict results to a college via `college`.

    Note: this tool is invoked on every chat turn, so it may be called for
    unrelated conversations. When the user's message has no connection to a
    study/degree recommendation, respond briefly and stay on their actual topic
    rather than forcing a recommendation.
    """
    interest = (interest or "").strip().lower()
    college_filter = (college or "").strip()

    entries = _load_colleges()
    if college_filter:
        entries = [e for e in entries if college_filter in e["college"]]

    tokens = [
        t
        for t in interest.split()
        if t
    ]

    def score(e: dict) -> int:
        hay = f"{e['degree']} {e['college']}".lower()
        s = sum(1 for t in tokens if t in hay)
        if interest and interest in hay:
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
def get_degree_details(degree: str) -> str:
    """Fetch detailed information about a specific degree (major/department).

    Call this when the user asks for details about a particular degree, such as
    its curriculum, introduction, admissions requirements, or what it studies.
    Pass the degree name (e.g. "국어국문학과", "경영학과") as `degree`. The tool
    looks up the degree's official homepage URL from the catalogue and fetches
    a readable summary of it.
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
    mcp.run(transport="streamable-http", host="127.0.0.1", port=3001)
