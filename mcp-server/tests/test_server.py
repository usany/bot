import json
from datetime import datetime

import httpx
import pytest
from mcp import Client

from opencode_mcp import server
from opencode_mcp.server import OFF_TOPIC_REPLY, mcp, parse_job_list


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with Client(mcp, raise_exceptions=True) as c:
        yield c


@pytest.mark.anyio
async def test_off_topic_reply(client: Client):
    result = await client.call_tool("off_topic_reply", {})
    assert result.structured_content == {"result": OFF_TOPIC_REPLY}
    assert result.content[0].text == "I can only respond to recruiting questions."


@pytest.mark.anyio
async def test_current_time(client: Client):
    result = await client.call_tool("current_time", {"timezone": "Asia/Seoul"})
    stamp = datetime.fromisoformat(result.structured_content["result"])
    assert stamp.utcoffset().total_seconds() == 9 * 3600


SAMPLE_JOB_LIST = """<?xml version='1.0' encoding='UTF-8'?>
<wantedRoot>
  <total>1</total>
  <startPage>1</startPage>
  <display>10</display>
  <wanted>
    <wantedAuthNo>K123</wantedAuthNo>
    <company>테스트회사</company>
    <title>백엔드 개발자</title>
    <region>서울 강남구</region>
    <closeDt>채용시까지</closeDt>
    <wantedInfoUrl>https://www.work24.go.kr/wanted/K123</wantedInfoUrl>
  </wanted>
</wantedRoot>"""


@pytest.fixture
def work24(monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, text=SAMPLE_JOB_LIST)

    monkeypatch.setenv("WORK24_AUTH_KEY", "test-key")
    monkeypatch.setattr(server, "_work24_transport", httpx.MockTransport(handler))
    return requests


@pytest.mark.anyio
async def test_search_job_postings(client: Client, work24):
    result = await client.call_tool("search_job_postings", {"keyword": "개발자", "display": 5})
    data = result.structured_content
    assert data["total"] == 1
    assert data["jobs"][0]["company"] == "테스트회사"
    assert data["jobs"][0]["title"] == "백엔드 개발자"

    params = work24[0].url.params
    assert params["keyword"] == "개발자"
    assert params["authKey"] == "test-key"
    assert params["callTp"] == "L"
    assert params["returnType"] == "XML"
    assert params["display"] == "5"


def test_parse_job_list_error():
    xml = "<GO24><error>개인회원은 사용할 수 없는 OPEN-API입니다.</error></GO24>"
    with pytest.raises(ValueError, match="개인회원"):
        parse_job_list(xml)


@pytest.fixture
def jooble(monkeypatch):
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "totalCount": 1,
                "jobs": [
                    {
                        "title": "Backend <b>Developer</b>",
                        "company": "Acme",
                        "location": "Seoul",
                        "salary": "",
                        "type": "Full-time",
                        "snippet": "&nbsp;Build <b>APIs</b>...&nbsp;",
                        "source": "example.com",
                        "updated": "2026-09-20T00:00:00.0000000",
                        "link": "https://jooble.org/desc/123",
                        "id": 123,
                    }
                ],
            },
        )

    monkeypatch.setenv("JOOBLE_KEY", "test-key")
    monkeypatch.setattr(server, "_jooble_transport", httpx.MockTransport(handler))
    return requests


@pytest.mark.anyio
async def test_search_jooble_jobs(client: Client, jooble):
    result = await client.call_tool(
        "search_jooble_jobs", {"keyword": "developer", "location": "Seoul", "results_per_page": 5}
    )
    data = result.structured_content
    assert data["total"] == 1
    job = data["jobs"][0]
    assert job["title"] == "Backend Developer"
    assert job["snippet"] == "Build APIs..."
    assert job["link"] == "https://jooble.org/desc/123"

    request = jooble[0]
    assert request.method == "POST"
    assert request.url.path == "/api/test-key"
    assert json.loads(request.content) == {
        "keywords": "developer",
        "location": "Seoul",
        "page": "1",
        "ResultOnPage": "5",
    }
