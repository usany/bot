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
                "macro_credits": meta.get("credits1"),
                "micro_credits": meta.get("credits2"),
            }
        )
    return entries


@mcp.tool()
def recommend_study(interest: str, college: str = "") -> str:
    """Recommend a degree (major/department) to study from the college catalogue.

    Call this when the user asks what to study, for a degree/major recommendation,
    or which department matches their interest. Provide the user's interest/field
    as `interest`, and optionally restrict results to a college via `college`.
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


if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="127.0.0.1", port=3001)
