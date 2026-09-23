import os

import httpx
from mcp.server import MCPServer

OPENCODE_URL = os.environ.get("OPENCODE_URL", "http://127.0.0.1:4096")

mcp = MCPServer(
    "OpenCode",
    instructions="Chat with the local OpenCode server. Reuse the returned session_id to continue a conversation.",
)


def opencode_client() -> httpx.AsyncClient:
    # Replaced in tests with a client backed by httpx.MockTransport.
    return httpx.AsyncClient(base_url=OPENCODE_URL, timeout=httpx.Timeout(10, read=None))


@mcp.tool()
async def health() -> str:
    """Report whether the OpenCode server is reachable."""
    try:
        async with opencode_client() as client:
            (await client.get("/config")).raise_for_status()
    except httpx.HTTPError:
        return "unavailable"
    return "ready"


@mcp.tool()
async def chat(message: str, session_id: str | None = None) -> dict[str, str]:
    """Send a message to OpenCode and return its reply.

    Omit session_id to start a new session; pass the returned one to continue it.
    """
    if not message.strip():
        raise ValueError("Message is required")

    async with opencode_client() as client:
        if not session_id:
            res = await client.post("/session", json={"title": "MCP Chat"})
            res.raise_for_status()
            session_id = res.json()["id"]

        res = await client.post(
            f"/session/{session_id}/message",
            json={"parts": [{"type": "text", "text": message}]},
        )
        res.raise_for_status()

    text = "\n".join(p["text"] for p in res.json()["parts"] if p.get("type") == "text").strip()
    return {"message": text, "session_id": session_id}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
