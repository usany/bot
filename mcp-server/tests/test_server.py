from datetime import datetime

import pytest
from mcp import Client

from opencode_mcp.server import mcp


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with Client(mcp, raise_exceptions=True) as c:
        yield c


@pytest.mark.anyio
async def test_current_time(client: Client):
    result = await client.call_tool("current_time", {"timezone": "Asia/Seoul"})
    stamp = datetime.fromisoformat(result.structured_content["result"])
    assert stamp.utcoffset().total_seconds() == 9 * 3600
