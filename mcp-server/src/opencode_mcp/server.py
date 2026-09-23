from datetime import datetime
from zoneinfo import ZoneInfo

from mcp.server import MCPServer

# Loaded by OpenCode via opencode.json; add the tools you want OpenCode's agent to have here.
mcp = MCPServer("project", instructions="Project tools for the OpenCode chat agent.")


@mcp.tool()
def current_time(timezone: str = "UTC") -> str:
    """Return the current date and time as ISO 8601 in the given IANA timezone (e.g. Asia/Seoul)."""
    return datetime.now(ZoneInfo(timezone)).isoformat(timespec="seconds")


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
