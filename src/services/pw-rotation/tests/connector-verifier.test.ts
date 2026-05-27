import { describe, expect, it, vi } from "vitest";
import {
  type HttpGetFn,
  type HttpGetResult,
  verifyConnectorRunning,
} from "../libs/connector-verifier";

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

const buildHttpGet = (responses: HttpGetResult[]): HttpGetFn => {
  let i = 0;
  return async (_hostname, _port, _path) => {
    if (i >= responses.length) {
      return responses[responses.length - 1];
    }
    return responses[i++];
  };
};

const okBody = (state: string, taskStates: string[], trace?: string): string =>
  JSON.stringify({
    name: "source.jdbc.appian-connector-dbo-1",
    connector: { state, worker_id: "wkr" },
    tasks: taskStates.map((s, idx) => ({
      id: idx,
      state: s,
      worker_id: "wkr",
      trace: idx === 0 ? trace : undefined,
    })),
  });

describe("verifyConnectorRunning", () => {
  it("returns running when connector and all tasks are RUNNING", async () => {
    const httpGet = buildHttpGet([{ statusCode: 200, body: okBody("RUNNING", ["RUNNING"]) }]);
    const result = await verifyConnectorRunning("10.0.0.1", "source.jdbc.appian-connector-dbo-1", {
      httpGet,
      sleep: noSleep,
      pollIntervalMs: 1,
      timeoutMs: 10_000,
    });
    expect(result).toEqual({ status: "running" });
  });

  it("returns failed with trace when a task is FAILED", async () => {
    const trace = "java.sql.SQLException: ORA-01017: invalid username/password";
    const httpGet = buildHttpGet([
      { statusCode: 200, body: okBody("RUNNING", ["FAILED"], trace) },
    ]);
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep: noSleep,
      pollIntervalMs: 1,
      timeoutMs: 10_000,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.traceSnippet).toContain("ORA-01017");
      expect(result.taskStates).toEqual(["FAILED"]);
    }
  });

  it("returns not_found on HTTP 404", async () => {
    const httpGet = buildHttpGet([{ statusCode: 404, body: "not found" }]);
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep: noSleep,
      pollIntervalMs: 1,
      timeoutMs: 10_000,
    });
    expect(result.status).toBe("not_found");
  });

  it("retries on transient state and eventually returns running", async () => {
    const httpGet = buildHttpGet([
      { statusCode: 200, body: okBody("UNASSIGNED", []) },
      { statusCode: 200, body: okBody("RUNNING", ["RUNNING"]) },
    ]);
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep: noSleep,
      pollIntervalMs: 1,
      timeoutMs: 10_000,
    });
    expect(result.status).toBe("running");
  });

  it("returns timeout when never RUNNING", async () => {
    const httpGet = buildHttpGet([{ statusCode: 200, body: okBody("UNASSIGNED", []) }]);
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const sleep = (ms: number): Promise<void> => {
      now += ms;
      return Promise.resolve();
    };
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep,
      pollIntervalMs: 100,
      timeoutMs: 500,
    });
    expect(result.status).toBe("timeout");
    if (result.status === "timeout") {
      expect(result.lastConnectorState).toBe("UNASSIGNED");
    }
    vi.restoreAllMocks();
  });

  it("treats malformed JSON as fetch_failed and retries", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const sleep = (ms: number): Promise<void> => {
      now += ms;
      return Promise.resolve();
    };
    const httpGet = buildHttpGet([
      { statusCode: 200, body: "<<<garbage" },
      { statusCode: 200, body: "<<<garbage" },
    ]);
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep,
      pollIntervalMs: 100,
      timeoutMs: 300,
    });
    expect(result.status).toBe("timeout");
    vi.restoreAllMocks();
  });

  it("treats HTTP 500 as fetch_failed and eventually times out", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const sleep = (ms: number): Promise<void> => {
      now += ms;
      return Promise.resolve();
    };
    const httpGet = buildHttpGet([{ statusCode: 500, body: "server error" }]);
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep,
      pollIntervalMs: 100,
      timeoutMs: 300,
    });
    expect(result.status).toBe("timeout");
    if (result.status === "timeout") {
      expect(result.lastConnectorState).toBe("http_500");
      expect(result.traceSnippet).toContain("server error");
    }
    vi.restoreAllMocks();
  });

  it("treats network errors as fetch_failed and eventually times out", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const sleep = (ms: number): Promise<void> => {
      now += ms;
      return Promise.resolve();
    };
    const httpGet: HttpGetFn = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep,
      pollIntervalMs: 100,
      timeoutMs: 300,
    });
    expect(result.status).toBe("timeout");
    if (result.status === "timeout") {
      expect(result.traceSnippet).toContain("ECONNREFUSED");
    }
    vi.restoreAllMocks();
  });

  it("treats PAUSED connector as failed", async () => {
    const httpGet = buildHttpGet([{ statusCode: 200, body: okBody("PAUSED", ["PAUSED"]) }]);
    const result = await verifyConnectorRunning("10.0.0.1", "c", {
      httpGet,
      sleep: noSleep,
      pollIntervalMs: 1,
      timeoutMs: 10_000,
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.connectorState).toBe("PAUSED");
    }
  });
});
