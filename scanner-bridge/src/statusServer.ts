import http from "node:http";

// A tiny read-only status endpoint for local troubleshooting — bound to
// 127.0.0.1 ONLY, never 0.0.0.0, so it is never reachable from the network
// (Part 3's explicit "bind any local service to localhost only").

export type BridgeState = "starting" | "watching" | "uploading" | "error";

export interface BridgeStatus {
  state: BridgeState;
  watchFolder: string;
  pendingFiles: number;
  lastBatchSize: number;
  lastBatchAt: string | null;
  totalCardsCreated: number;
  totalCardsRecognized: number;
  totalRecognitionFailures: number;
  lastError: string | null;
  startedAt: string;
}

export function createStatus(watchFolder: string): BridgeStatus {
  return {
    state: "starting",
    watchFolder,
    pendingFiles: 0,
    lastBatchSize: 0,
    lastBatchAt: null,
    totalCardsCreated: 0,
    totalCardsRecognized: 0,
    totalRecognitionFailures: 0,
    lastError: null,
    startedAt: new Date().toISOString(),
  };
}

export function startStatusServer(port: number, status: BridgeStatus): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/status" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status, null, 2));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Try /status." }));
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`[geega-scanner-bridge] Status: http://127.0.0.1:${port}/status`);
  });
  return server;
}
