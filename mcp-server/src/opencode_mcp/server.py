from datetime import datetime
from zoneinfo import ZoneInfo

from mcp.server import MCPServer

OFF_TOPIC_REPLY = "I can only respond to recruiting questions."

# Loaded by OpenCode via opencode.json; add the tools you want OpenCode's agent to have here.
mcp = MCPServer(
    "project",
    instructions=(
        "This assistant only answers recruiting questions (jobs, hiring, interviews, resumes, candidates, "
        "offers), plus questions about the current date or time, which it answers with current_time. For any "
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


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
