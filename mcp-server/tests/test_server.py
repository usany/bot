import json

import httpx
import pytest
from mcp import Client

from opencode_mcp import server


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with Client(server.mcp, raise_exceptions=True) as c:
        yield c


def fake_opencode(monkeypatch: pytest.MonkeyPatch, handler) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    monkeypatch.setattr(
        server,
        "opencode_client",
        lambda: httpx.AsyncClient(base_url="http://opencode", transport=httpx.MockTransport(record)),
    )
    return requests


@pytest.mark.anyio
async def test_health_ready(client: Client, monkeypatch: pytest.MonkeyPatch):
    fake_opencode(monkeypatch, lambda _: httpx.Response(200, json={}))
    result = await client.call_tool("health", {})
    assert result.structured_content == {"result": "ready"}


@pytest.mark.anyio
async def test_health_unavailable(client: Client, monkeypatch: pytest.MonkeyPatch):
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    fake_opencode(monkeypatch, refuse)
    result = await client.call_tool("health", {})
    assert result.structured_content == {"result": "unavailable"}


@pytest.mark.anyio
async def test_chat_creates_session(client: Client, monkeypatch: pytest.MonkeyPatch):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/session":
            return httpx.Response(200, json={"id": "ses_1"})
        return httpx.Response(
            200, json={"parts": [{"type": "reasoning", "text": "hmm"}, {"type": "text", "text": "hi there"}]}
        )

    requests = fake_opencode(monkeypatch, handler)
    result = await client.call_tool("chat", {"message": "hello"})

    assert result.structured_content == {"message": "hi there", "session_id": "ses_1"}
    assert [r.url.path for r in requests] == ["/session", "/session/ses_1/message"]
    assert json.loads(requests[1].content) == {"parts": [{"type": "text", "text": "hello"}]}


@pytest.mark.anyio
async def test_chat_reuses_session(client: Client, monkeypatch: pytest.MonkeyPatch):
    requests = fake_opencode(
        monkeypatch, lambda _: httpx.Response(200, json={"parts": [{"type": "text", "text": "again"}]})
    )
    result = await client.call_tool("chat", {"message": "more", "session_id": "ses_9"})

    assert result.structured_content == {"message": "again", "session_id": "ses_9"}
    assert [r.url.path for r in requests] == ["/session/ses_9/message"]
