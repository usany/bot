import express, { Request, Response } from "express";
import cors from "cors";
import net from "node:net";
import { createOpencode } from "@opencode-ai/sdk";

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

interface ChatRequest {
  message: string;
}

interface ChatResponse {
  message?: string;
  error?: string;
}

type OpenCodeClient = Awaited<ReturnType<typeof createOpencode>>["client"];

let client: OpenCodeClient | null = null;
let sessionId: string | null = null;

// The SDK defaults to port 4096; a stale or separately running opencode server there makes startup fail.
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function initializeSDK(): Promise<void> {
  try {
    const opencode = await createOpencode({ port: await getFreePort(), timeout: 15000 });
    client = opencode.client;

    process.on("exit", () => opencode.server.close());
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));

    const { data: session } = await client.session.create({
      body: { title: "Responsive Chatbot" },
      throwOnError: true,
    });
    sessionId = session.id;
    console.log(`OpenCode ready at ${opencode.server.url}, session: ${sessionId}`);
  } catch (err) {
    console.error("SDK initialization error:", err instanceof Error ? err.message : err);
  }
}

initializeSDK();

app.post(
  "/api/chat",
  async (req: Request<{}, {}, ChatRequest>, res: Response<ChatResponse>) => {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!client || !sessionId) {
      return res.status(503).json({ error: "SDK not initialized. Please check server logs." });
    }

    try {
      const { data } = await client.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: message }] },
        throwOnError: true,
      });

      const text = data.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();

      res.json({ message: text || "I received your message but could not generate a response." });
    } catch (err) {
      console.error("Chat error:", err);
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to process message",
      });
    }
  },
);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: client && sessionId ? "ready" : "initializing",
    initialized: !!client,
    sessionId,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
