import pytest
from mcp import Client

from opencode_mcp.server import OFF_TOPIC_REPLY, mcp


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
