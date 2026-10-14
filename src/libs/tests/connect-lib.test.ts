import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectRestApiWithRetry, testConnector } from "../connect-lib";

let server: http.Server;
let port: number;
let requests: number;

async function startServer(listener: http.RequestListener): Promise<void> {
  server = http.createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
}

describe("connect-lib HTTP limits", () => {
  beforeEach(() => {
    requests = 0;
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("testConnector rejects when the worker never responds", async () => {
    await startServer(() => undefined);
    await expect(testConnector("127.0.0.1", { name: "c", config: {} }, port, 50)).rejects.toThrow("Request timed out after 50 ms");
  });

  it("testConnector resolves the parsed status", async () => {
    await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "c", connector: { state: "RUNNING", worker_id: "w" }, tasks: [], type: "source" }));
    });
    await expect(testConnector("127.0.0.1", { name: "c", config: {} }, port)).resolves.toMatchObject({ connector: { state: "RUNNING" } });
  });

  it("connectRestApiWithRetry rejects when the worker never responds", async () => {
    await startServer(() => undefined);
    await expect(connectRestApiWithRetry({ hostname: "127.0.0.1", port, timeoutMs: 50 })).rejects.toThrow("Request timed out after 50 ms");
  });

  it("connectRestApiWithRetry does not start another attempt after a mid-response timeout rejects", async () => {
    await startServer((_req, res) => {
      requests += 1;
      res.writeHead(200);
      res.write("{");
    });
    await expect(connectRestApiWithRetry({ hostname: "127.0.0.1", port, timeoutMs: 50, retryDelayMs: 1 })).rejects.toThrow(
      "Request timed out after 50 ms"
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toBe(1);
  });

  it("connectRestApiWithRetry stops after 5 attempts when responses keep dropping", async () => {
    await startServer((_req, res) => {
      requests += 1;
      res.writeHead(200);
      res.write("{");
      setTimeout(() => res.socket?.destroy(), 5);
    });
    await expect(connectRestApiWithRetry({ hostname: "127.0.0.1", port, retryDelayMs: 1 })).rejects.toThrow("failed after 5 attempts");
    expect(requests).toBe(5);
  });
});
