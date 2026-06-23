import * as http from "http";
import type { VerificationOutcome } from "./types";

export interface VerifyOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  httpGet?: HttpGetFn;
  port?: number;
}

export interface ConnectorTaskStatus {
  id: number;
  state: string;
  worker_id?: string;
  trace?: string;
}

export interface ConnectorStatusResponse {
  name: string;
  connector?: { state?: string; worker_id?: string };
  tasks?: ReadonlyArray<ConnectorTaskStatus>;
}

const RUNNING = "RUNNING";
const PAUSED = "PAUSED";
const FAILED_STATES: ReadonlySet<string> = new Set(["FAILED", "DESTROYED"]);
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_PORT = 8083;
const TRACE_SNIPPET_MAX_CHARS = 4_000;

export type HttpGetFn = (
  hostname: string,
  port: number,
  path: string,
) => Promise<HttpGetResult>;

export interface HttpGetResult {
  statusCode: number | undefined;
  body: string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultHttpGet: HttpGetFn = (hostname, port, path) => {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port,
        path,
        method: "GET",
        headers: { Accept: "application/json" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf-8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode, body });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
};

export async function verifyConnectorRunning(
  workerIp: string,
  connectorName: string,
  options: VerifyOptions = {},
): Promise<VerificationOutcome> {
  const httpGet = options.httpGet ?? defaultHttpGet;
  const sleep = options.sleep ?? defaultSleep;
  const port = options.port ?? DEFAULT_PORT;
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const startedAt = Date.now();
  let lastConnectorState: string | undefined;
  let lastTraceSnippet: string | undefined;

  while (Date.now() - startedAt < timeout) {
    const fetched = await fetchStatus(httpGet, workerIp, port, connectorName);

    if (fetched.kind === "missing") {
      return { status: "not_found", message: fetched.message };
    }

    if (fetched.kind === "fetch_failed") {
      lastConnectorState = `http_${fetched.statusCode ?? "error"}`;
      lastTraceSnippet = truncate(fetched.body);
      await sleep(interval);
      continue;
    }

    const classification = classifyStatus(fetched.data);
    lastConnectorState = classification.connectorState;
    lastTraceSnippet = classification.traceSnippet ?? lastTraceSnippet;

    if (classification.kind === "running") {
      return { status: "running" };
    }
    if (classification.kind === "failed") {
      return {
        status: "failed",
        connectorState: classification.connectorState,
        taskStates: classification.taskStates,
        traceSnippet: classification.traceSnippet,
      };
    }

    await sleep(interval);
  }

  return {
    status: "timeout",
    lastConnectorState,
    traceSnippet: lastTraceSnippet,
  };
}

type FetchOutcome =
  | { kind: "ok"; data: ConnectorStatusResponse }
  | { kind: "missing"; message: string }
  | { kind: "fetch_failed"; statusCode: number | undefined; body: string };

async function fetchStatus(
  httpGet: HttpGetFn,
  hostname: string,
  port: number,
  connectorName: string,
): Promise<FetchOutcome> {
  let response: HttpGetResult;
  try {
    response = await httpGet(hostname, port, `/connectors/${connectorName}/status`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown HTTP error";
    return { kind: "fetch_failed", statusCode: undefined, body: message };
  }

  if (response.statusCode === 404) {
    return {
      kind: "missing",
      message: `Connector ${connectorName} not found at ${hostname}:${port}`,
    };
  }

  if (response.statusCode === undefined || response.statusCode >= 400) {
    return {
      kind: "fetch_failed",
      statusCode: response.statusCode,
      body: response.body,
    };
  }

  try {
    const parsed = JSON.parse(response.body) as ConnectorStatusResponse;
    return { kind: "ok", data: parsed };
  } catch {
    return { kind: "fetch_failed", statusCode: response.statusCode, body: response.body };
  }
}

interface ClassifiedStatus {
  kind: "running" | "failed" | "transient";
  connectorState: string | undefined;
  taskStates: ReadonlyArray<string>;
  traceSnippet: string | undefined;
}

function classifyStatus(payload: ConnectorStatusResponse): ClassifiedStatus {
  const connectorState = payload.connector?.state;
  const tasks = payload.tasks ?? [];
  const taskStates = tasks.map((t) => t.state);
  const failedTask = tasks.find((t) => FAILED_STATES.has(t.state));
  const traceSnippet =
    failedTask?.trace !== undefined ? truncate(failedTask.trace) : undefined;

  if (connectorState === undefined) {
    return { kind: "transient", connectorState, taskStates, traceSnippet };
  }
  if (FAILED_STATES.has(connectorState) || failedTask !== undefined) {
    return { kind: "failed", connectorState, taskStates, traceSnippet };
  }
  if (
    connectorState === RUNNING &&
    tasks.length > 0 &&
    tasks.every((t) => t.state === RUNNING)
  ) {
    return { kind: "running", connectorState, taskStates, traceSnippet };
  }
  if (connectorState === PAUSED) {
    return { kind: "failed", connectorState, taskStates, traceSnippet };
  }
  return { kind: "transient", connectorState, taskStates, traceSnippet };
}

function truncate(input: string): string {
  if (input.length <= TRACE_SNIPPET_MAX_CHARS) {
    return input;
  }
  return `${input.slice(0, TRACE_SNIPPET_MAX_CHARS)}…[truncated]`;
}
