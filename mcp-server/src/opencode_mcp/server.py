import html
import logging
import os
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from dotenv import load_dotenv
from mcp.server import MCPServer

# OpenCode spawns this server without loading the repo's env files, so load them here.
# Real environment variables win; .env.local overrides .env.
_REPO_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(_REPO_ROOT / ".env.local")
load_dotenv(_REPO_ROOT / ".env")

OFF_TOPIC_REPLY = "I can only respond to recruiting questions."

WORK24_JOB_LIST_URL = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do"
JOOBLE_API_URL = "https://jooble.org/api/"
# Tests swap these for an httpx.MockTransport.
_work24_transport: httpx.AsyncBaseTransport | None = None
_jooble_transport: httpx.AsyncBaseTransport | None = None
# httpx logs full request URLs at INFO, which would leak the auth key.
logging.getLogger("httpx").setLevel(logging.WARNING)

# Loaded by OpenCode via opencode.json; add the tools you want OpenCode's agent to have here.
mcp = MCPServer(
    "project",
    instructions=(
        "This assistant only answers recruiting questions (jobs, hiring, interviews, resumes, candidates, "
        "offers), plus questions about the current date or time, which it answers with current_time. Use "
        "search_jooble_jobs or search_job_postings to look up real job postings on Work24 (고용24). For any "
        "other message, call off_topic_reply and reply with its result verbatim."
    ),
)


@mcp.tool()
def off_topic_reply() -> str:
    """Get the reply for a user message that is NOT about recruiting.

    Call this whenever the user's question is unrelated to recruiting (jobs, hiring, interviews, resumes,
    candidates, offers) and is not about the current date or time, then send the returned text to the user
    exactly as-is, with nothing added.
    """
    return OFF_TOPIC_REPLY


@mcp.tool()
def current_time(timezone: str = "UTC") -> str:
    """Return the current date and time as ISO 8601 in the given IANA timezone (e.g. Asia/Seoul).

    Use this to answer the user's questions about the current date or time; these are allowed even though
    they are not about recruiting.
    """
    return datetime.now(ZoneInfo(timezone)).isoformat(timespec="seconds")


def parse_job_list(xml_text: str) -> dict[str, Any]:
    """Parse a Work24 job-list XML response into {total, start_page, display, jobs}."""
    root = ET.fromstring(xml_text)
    if (error := root.findtext("error")) is not None:
        raise ValueError(f"Work24 API error: {error.strip()}")

    def to_int(tag: str) -> int | None:
        text = (root.findtext(tag) or "").strip()
        return int(text) if text.isdigit() else None

    jobs = [
        {child.tag: (child.text or "").strip() for child in wanted}
        for wanted in root.iter("wanted")
    ]
    return {
        "total": to_int("total"),
        "start_page": to_int("startPage"),
        "display": to_int("display"),
        "jobs": jobs,
    }


@mcp.tool()
async def search_job_postings(keyword: str, start_page: int = 1, display: int = 10) -> dict[str, Any]:
    """Search current job postings (채용정보) on Work24 (고용24) by keyword and return the recruiting list.

    Args:
        keyword: Search term, e.g. a job title, skill or company name (Korean works best, e.g. "개발자").
        start_page: 1-based page number.
        display: Number of postings per page (1-100).

    Each job includes fields such as company, title, sal (salary), region, career, closeDt (closing date)
    and wantedInfoUrl (link to the posting).
    """
    auth_key = os.environ.get("WORK24_AUTH_KEY")
    if not auth_key:
        raise ValueError("WORK24_AUTH_KEY environment variable is not set")

    params = {
        "authKey": auth_key,
        "callTp": "L",
        "returnType": "XML",
        "startPage": max(start_page, 1),
        "display": min(max(display, 1), 100),
        "keyword": keyword,
    }
    async with httpx.AsyncClient(transport=_work24_transport, timeout=10) as client:
        response = await client.get(WORK24_JOB_LIST_URL, params=params)
        response.raise_for_status()
    return parse_job_list(response.text)


def _clean_text(value: Any) -> str:
    """Strip HTML tags and entities (Jooble snippets contain <b> highlights and &nbsp;)."""
    text = html.unescape(re.sub(r"<[^>]+>", "", str(value or "")))
    return " ".join(text.split())


@mcp.tool()
async def search_jooble_jobs(
    keyword: str, location: str = "", page: int = 1, results_per_page: int = 10
) -> dict[str, Any]:
    """Search current job postings worldwide on Jooble by keyword and return the recruiting list.

    Args:
        keyword: Search term, e.g. a job title, skill or company name (e.g. "backend developer").
        location: Optional city/region/country to filter by (e.g. "Seoul"); empty means anywhere.
        page: 1-based page number.
        results_per_page: Number of postings per page (1-100).

    Returns {total, jobs}, where each job has title, company, location, salary, type, snippet, source,
    updated and link (URL of the posting).
    """
    api_key = os.environ.get("JOOBLE_KEY")
    if not api_key:
        raise ValueError("JOOBLE_KEY environment variable is not set")

    body: dict[str, Any] = {
        "keywords": keyword,
        "page": str(max(page, 1)),
        "ResultOnPage": str(min(max(results_per_page, 1), 100)),
    }
    if location:
        body["location"] = location

    async with httpx.AsyncClient(transport=_jooble_transport, timeout=15) as client:
        response = await client.post(JOOBLE_API_URL + api_key, json=body)
    if response.status_code == 403:
        raise ValueError("Jooble rejected the API key (403); check JOOBLE_KEY")
    response.raise_for_status()

    data = response.json()
    fields = ("title", "company", "location", "salary", "type", "snippet", "source", "updated", "link")
    return {
        "total": data.get("totalCount", 0),
        "jobs": [{f: _clean_text(job.get(f)) for f in fields} for job in data.get("jobs", [])],
    }


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
