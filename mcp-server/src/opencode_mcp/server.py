from mcp.server import MCPServer

OFF_TOPIC_REPLY = "I can only respond to recruiting questions."

# Loaded by OpenCode via opencode.json; add the tools you want OpenCode's agent to have here.
mcp = MCPServer(
    "project",
    instructions=(
        "This assistant only answers recruiting questions (jobs, hiring, interviews, resumes, candidates, "
        "offers). If the user's message is not about recruiting, call off_topic_reply and reply with its "
        "result verbatim."
    ),
)


@mcp.tool()
def off_topic_reply() -> str:
    """Get the reply for a user message that is NOT about recruiting.

    Call this whenever the user's question is unrelated to recruiting (jobs, hiring, interviews, resumes,
    candidates, offers), then send the returned text to the user exactly as-is, with nothing added.
    """
    return OFF_TOPIC_REPLY


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
