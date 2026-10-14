# Appian Connector Stability and Jira Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every connection problem on the Appian JDBC connectors reach a person: email and Slack in every stage, plus an OY2 Jira ticket in val and production.

**Architecture:** Phase 1 fixes and generates the CloudWatch alarms from one list of connector names, adds a heartbeat and Lambda-error alarm, and bounds the Kafka Connect HTTP calls. Phase 2 adds a restart cap so the val and production health check can be re-enabled safely. Phase 3 adds a `jiraNotifier` Lambda that receives CloudWatch alarm state-change events and ECS task-stopped events from EventBridge and opens or comments on Jira tickets through the Jira Data Center REST API.

**Tech Stack:** TypeScript, Node.js 24 Lambdas bundled by `NodejsFunction` (esbuild), AWS CDK 2.257 (`aws-cdk-lib`), AWS SDK v3, vitest (Lambda code), jest with `aws-cdk-lib/assertions` (infra), GitHub Actions.

**Spec:** [appian-connector-stability-spec.md](appian-connector-stability-spec.md). Section references below (for example "spec 3.3") point there.

## Global Constraints

- Work directly on the local `master`. Do not create feature, worktree, or temporary branches, and do not open feature pull requests. All of Tasks 1–12 land as one commit (Task 13). Do not push anything until Task 15 says to: a push to `master` deploys master and opens the `val` release PR. Never push to `val` or `production`.
- Only the coordinating agent runs `git add`, `git commit`, or `git push`. Implementer subagents edit files and run tests only.
- Style: double quotes, semicolons, 2-space indent, print width 150 (`.prettierrc.json`). Imports at the top of the module. Switches over unions end in a `never` check.
- Comments only for constraints the code cannot show. No narration comments.
- Lambdas use `Runtime.NODEJS_24_X` and `bundling: { minify: true, sourceMap: true, externalModules: ["@aws-sdk/*"] }`.
- Never log, test-fixture, or send to Jira a database password, JDBC connection string, or Jira token.
- Do not change how `legacydbPassword` is supplied. Do not add an automatic password updater.
- No alarm on `{connectorName}_oracle_errors`. No alarm on topic or row freshness: this connector can go days without data.
- Val and production `healthCheckSchedule` stay `DISABLED` in code until Tasks 17 and 18.
- Alarms that may open a ticket are named `{servicePrefix}-conn-...`. No other alarm may use `-conn-`.
- Jira ticket values (spec 5.3): project `OY2`, issue type id `10100` (Bug), labels `macpro_appian_connector` plus `VAL` or `PROD`, Epic Link field `customfield_10100` = `OY2-29580`, component ids `67202` (BigMAC) and `78303` (MACPro Appian), Working Team field `customfield_26713` = option id `51914`, reporter and assignee `{ "name": "PEIT" }`.
- Jira secret `appian/{stage}/jira` already exists in all three accounts as `{"url":"https://jiraent.cms.gov","token":"..."}`. Do not create or change it.
- Done means `yarn test-tsc`, `yarn test-ci`, and `yarn --cwd infra test` all exit 0.

---

## Execution and parallelism

Everything happens in the one checkout on `master`, and ships as one commit:

| Part | Tasks | Result |
| --- | --- | --- |
| A: health alarms and restart cap | 1–7 | Edits staged on `master`, not committed |
| B: Jira notifier | 8–12 | Edits staged on `master`, not committed |
| C: commit, CLI deploy, push | 13–15 | One commit, deployed to master from the CLI and verified, then pushed |
| D: rollout to val and production | 16–18 | Val release PR, notifier test, then enabling the schedules |

The local `master` already has two unpushed docs commits (the spec, this plan, and `AGENTS.md` facts), plus uncommitted `AGENTS.md` and plan edits. Task 13 folds all of them and Tasks 1–12 into a single commit on top of `origin/master`.

Tasks in the same wave touch disjoint files and can run as parallel subagents in the same checkout. Subagents never run git commands, so they cannot fight over `.git/index.lock`. Each task's last step is a staging step that the coordinator runs after that task's reviews pass. After each wave, the coordinator runs the full test commands from Global Constraints before starting the next wave.

### Review gates

The coordinator uses superpowers:subagent-driven-development: a fresh implementer subagent per task, then a spec-compliance review and a code-quality review of that task. Findings go back to the implementer until both reviewers approve. Only then does the coordinator stage the task. Before the single commit (Task 13), the coordinator also runs, on the whole uncommitted diff, these checks, and loops fixes until each one passes or the user waives a finding:

1. superpowers:requesting-code-review, over all of Tasks 1–12 against the spec.
2. The `bugbot` subagent, `Diff: uncommitted changes`.
3. The `security-review` subagent, `Diff: uncommitted changes`. Pay attention to the Jira token, the IAM policies, and logging. Also have it read `git diff origin/master..HEAD`, the two unpushed docs commits that the single commit folds in.
4. superpowers:verification-before-completion: Task 13 Step 3 (actionlint, the three test commands, a `cdk synth` of master, val, and production, and a secret scan of everything that will be pushed).

The same gates run again after any later change to the single commit, including a fix made in Task 14.

When fixing a failing test or a deploy error, use superpowers:systematic-debugging rather than guessing.

| Wave | Parallel tasks | Depends on |
| --- | --- | --- |
| 1 | Task 1 (CI), Task 2 (connector names), Task 3 (HTTP limits), Task 4 (heartbeat), Task 8 (Jira ticket content), Task 9 (Jira client) | nothing |
| 2 | Task 5 (restart cap), Task 6 (infra alarms), Task 10 (notifier handler) | 5 needs 2 and 4. 6 needs 2. 10 needs 8 and 9. |
| 3 | Task 7 (docs A), Task 11 (infra notifier) | 7 needs 5 and 6. 11 needs 6 and 10. |
| 4 | Task 12 (docs B) | 7 and 11 |
| 5 | Task 13 (review gates and single commit) | 1–12 staged |
| Deploy | Tasks 14 → 15, in order, with the user's approval for each AWS write and for the push | 13 |
| Rollout | Tasks 16 → 17 → 18, in order, with the user's approval for each AWS write, each push, and each release PR merge | 15 |

## File map

| File | Status | Responsibility | Task |
| --- | --- | --- | --- |
| `.github/workflows/unit-tests.yml` | create | Runs type check, vitest, and infra jest | 1 |
| `.github/workflows/deploy.yml` | modify | Deploy waits for unit tests | 1 |
| `src/services/connector/libs/connector-names.json` | create | The one list of connector names | 2 |
| `src/services/connector/libs/connectors.ts` | modify | Uses the names; `connection.attempts: 1` | 2, 5 |
| `tsconfig.json` | modify | Allow JSON imports | 2 |
| `src/types/index.ts` | modify | `timeoutMs`, `retryDelayMs` on `HttpRequestParams` | 3 |
| `src/libs/connect-lib.ts` | modify | Request timeouts, retry limit | 3 |
| `src/libs/cloudwatch-lib.ts` | modify | `getMetricSum` | 5 |
| `src/services/connector/handlers/testConnectors.ts` | modify | Heartbeat, error message, restart cap | 4, 5 |
| `infra/lib/connector-alarms.ts` | create | Builds every `-conn-` alarm | 6 |
| `infra/lib/environment-config.ts` | modify | `healthCheckSchedule`, `jiraStageLabel` | 6, 11 |
| `infra/lib/appian-connector-stack.ts` | modify | Wire alarms, schedule state, IAM, notifier | 6, 11 |
| `src/services/connector/libs/jira-ticket-config.ts` | create | Fixed Jira field values | 8 |
| `src/services/connector/libs/jira-events.ts` | create | Event types, alarm-name parsing, titles | 8 |
| `src/services/connector/libs/jira-ticket.ts` | create | Summary, JQL, fields, description, comments | 8 |
| `src/services/connector/libs/jira-client.ts` | create | Secret loading and Jira REST calls | 9 |
| `src/services/connector/handlers/jiraNotifier.ts` | create | Create, comment, or ignore | 10 |
| `infra/lib/jira-notifier.ts` | create | Notifier Lambda, role, rule, DLQ, DLQ alarm | 11 |
| Tests under `src/**/tests/` and `infra/test/` | create or modify | Per task | all |
| `README.md`, `infra/README.md`, `src/services/alerts/README.md`, `AGENTS.md`, spec | modify | Docs | 7, 12 |

---

# Part A: health alarms and restart cap

Start on the local `master`: `git switch master && git status --short` (expect only this plan and `AGENTS.md` as uncommitted changes). Do not create a branch.

### Task 1: Unit-test workflow and deploy gate

There is no unit-test workflow today (only pre-commit, dependency review, deploy, destroy, and release PRs).

**Files:**
- Create: `.github/workflows/unit-tests.yml`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: reusable workflow `./.github/workflows/unit-tests.yml` (`workflow_call`), job id `unit-tests`.

- [ ] **Step 1: Confirm the commands pass locally (baseline)**

Run: `yarn install --frozen-lockfile && yarn test-tsc && yarn test-ci && yarn --cwd infra test`
Expected: all exit 0 (8 vitest tests, 4 jest tests at the time of writing).

- [ ] **Step 2: Create the workflow**

```yaml
name: Unit Tests

on:
  pull_request:
  workflow_call:

permissions:
  contents: read

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - uses: ./.github/actions/setup

      - name: Install dependencies
        run: yarn install --frozen-lockfile

      - name: Type check
        run: yarn test-tsc

      - name: Lambda unit tests
        run: yarn test-ci

      - name: Infra tests
        run: yarn test
        working-directory: infra
```

- [ ] **Step 3: Gate the deploy on it**

In `.github/workflows/deploy.yml`, add this job after `init`, and make `deploy` need it:

```yaml
  unit-tests:
    needs:
      - init
    uses: ./.github/workflows/unit-tests.yml

  deploy:
    runs-on: ubuntu-latest
    needs:
      - init
      - unit-tests
```

(Keep the rest of the `deploy` job unchanged.)

- [ ] **Step 4: Lint the workflows**

Run: `command -v actionlint && actionlint .github/workflows/unit-tests.yml .github/workflows/deploy.yml || echo "actionlint not installed"`
Expected: no errors. If actionlint is missing, install it (`brew install actionlint`) before Task 13: nothing else checks the workflows until the master `Deploy` run in Task 15.

- [ ] **Step 5: Stage (coordinator, after both reviews approve)**

```bash
git add .github/workflows/unit-tests.yml .github/workflows/deploy.yml
```

After the push in Task 15, the master `Deploy` run must show its `unit-tests` job passing before `deploy` starts, and the auto-created val release PR must show `Unit Tests / unit-tests` passing.

---

### Task 2: One list of connector names

**Files:**
- Create: `src/services/connector/libs/connector-names.json`
- Modify: `src/services/connector/libs/connectors.ts:1-6`, `tsconfig.json` (Module Resolution Options block)
- Test: `src/services/connector/tests/connectors.test.ts`

**Interfaces:**
- Produces: `connector-names.json`, an object whose values are connector names: `{ "appianDbo": "source.jdbc.appian-connector-dbo-1" }`. Infra (Task 6) reads it with `fs`; Lambda code imports it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import connectorNames from "../libs/connector-names.json";
import { connectors } from "../libs/connectors";

describe("connector names", () => {
  it("defines exactly one connector config per name in connector-names.json", () => {
    expect(connectors.map((connector) => connector.name).sort()).toEqual(Object.values(connectorNames).sort());
  });

  it("keeps the live connector name", () => {
    expect(connectorNames.appianDbo).toBe("source.jdbc.appian-connector-dbo-1");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `yarn test-ci connectors`
Expected: FAIL, cannot resolve `../libs/connector-names.json`.

- [ ] **Step 3: Implement**

`src/services/connector/libs/connector-names.json`:

```json
{
  "appianDbo": "source.jdbc.appian-connector-dbo-1"
}
```

`src/services/connector/libs/connectors.ts`, top of file:

```ts
import { queryString } from "./query";
import connectorNames from "./connector-names.json";
import type { ConnectorConfig } from "../../../types";

export const connectors: ConnectorConfig[] = [
  {
    name: connectorNames.appianDbo,
```

`tsconfig.json`, directly after the `"moduleResolution": "node"` line:

```json
    "resolveJsonModule": true,
    "allowSyntheticDefaultImports": true,
```

- [ ] **Step 4: Run tests and the type check**

Run: `yarn test-ci && yarn test-tsc`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Stage (coordinator, after both reviews approve)**

```bash
git add src/services/connector/libs/connector-names.json src/services/connector/libs/connectors.ts tsconfig.json src/services/connector/tests/connectors.test.ts
```

---

### Task 3: Bound the Kafka Connect HTTP calls

Spec 3.6. `connectRestApiWithRetry` retries a dropped response forever, and no request has a timeout. A dropped response surfaces as an `error` on the response (`ECONNRESET aborted`), not on the request.

**Files:**
- Modify: `src/types/index.ts` (`HttpRequestParams`), `src/libs/connect-lib.ts:1-56` and `:177-228`
- Test: `src/libs/tests/connect-lib.test.ts`

**Interfaces:**
- Produces: `HttpRequestParams.timeoutMs?: number`, `HttpRequestParams.retryDelayMs?: number`; `connectRestApiWithRetry(params: HttpRequestParams, attempt = 1): Promise<number | undefined>`; `testConnector(ip: string, config: ConnectorConfig, port = 8083, timeoutMs = 10000): Promise<ConnectorStatus>`. `testConnectors(cluster, service, connectors)` is unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run to make sure they fail**

Run: `yarn test-ci connect-lib`
Expected: FAIL. The timeout tests hit the vitest 5-second timeout. The retry test never settles.

- [ ] **Step 3: Implement**

`src/types/index.ts`, in `HttpRequestParams`, after `body?: unknown;`:

```ts
  timeoutMs?: number;
  retryDelayMs?: number;
```

`src/libs/connect-lib.ts`, replace everything from the `resolver` constant through the end of `connectRestApiWithRetry` with:

```ts
const CONNECT_PORT = 8083;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5_000;

const resolver = (req: http.ClientRequest, resolve: (value: number | undefined) => void): void => {
  console.log("Finished");
  req.socket?.destroy();
  resolve(req.socket?.destroyed ? 200 : undefined);
};

function applyTimeout(req: http.ClientRequest, timeoutMs: number): void {
  req.setTimeout(timeoutMs, () => {
    req.destroy(new Error(`Request timed out after ${timeoutMs} ms`));
  });
}

export async function connectRestApiWithRetry(params: HttpRequestParams, attempt = 1): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const retry = (e: string): void => {
      console.log("Got error: " + e);
      if (attempt >= MAX_ATTEMPTS) {
        reject(new Error(`Kafka Connect request failed after ${attempt} attempts: ${e}`));
        return;
      }
      setTimeout(() => {
        connectRestApiWithRetry(params, attempt + 1).then(resolve, reject);
      }, params.retryDelayMs ?? RETRY_DELAY_MS);
    };

    const options: http.RequestOptions = {
      hostname: params.hostname,
      port: params.port || CONNECT_PORT,
      path: params.path || "",
      method: params.method || "GET",
      headers: params.headers || {
        "Content-Type": "application/json",
      },
    };

    const req = http.request(options, (res) => {
      res
        .on("data", (d: Buffer) => {
          console.log(d.toString("utf-8"));
        })
        .on("error", (error) => {
          console.log("res.on error:", error);
          retry(`${error}`);
        })
        .on("end", () => {
          resolver(req, resolve);
        });
    });
    applyTimeout(req, params.timeoutMs ?? REQUEST_TIMEOUT_MS);

    req.on("error", (error) => {
      console.log("req.on error:", error);
      reject(error);
    });

    if (params.body) {
      req.write(JSON.stringify(params.body));
    }
    req.end();
  });
}
```

Replace `testConnector`'s signature and options, and add the timeout right after `http.request(...)`:

```ts
export async function testConnector(
  ip: string,
  config: ConnectorConfig,
  port = CONNECT_PORT,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<ConnectorStatus> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      hostname: ip,
      port,
      path: `/connectors/${config.name}/status`,
      headers: {
        "Content-Type": "application/json",
      },
    };
```

```ts
    const req = http.request(options, (res) => {
      // ...existing body unchanged...
    });
    applyTimeout(req, timeoutMs);
```

- [ ] **Step 4: Run tests**

Run: `yarn test-ci && yarn test-tsc`
Expected: PASS.

- [ ] **Step 5: Stage (coordinator, after both reviews approve)**

```bash
git add src/types/index.ts src/libs/connect-lib.ts src/libs/tests/connect-lib.test.ts
```

---

### Task 4: Heartbeat metric and readable errors in testConnectors

Spec 3.4 and 3.6. The catch block logs `JSON.stringify(e)`, which prints `{}` for an `Error`.

**Files:**
- Modify: `src/services/connector/handlers/testConnectors.ts` (catch block, add `finally`)
- Test: `src/services/connector/tests/health-check.test.ts`

**Interfaces:**
- Produces: metric `health_check_heartbeat` = 1 in namespace `process.env.namespace` on every run, success or caught error.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorStatus } from "../../../types";

const mocks = vi.hoisted(() => ({
  testConnectors: vi.fn(),
  restartConnectors: vi.fn(),
  sendMetricData: vi.fn(),
  getMetricSum: vi.fn(),
}));

vi.mock("../../../libs/connect-lib", () => ({
  testConnectors: mocks.testConnectors,
  restartConnectors: mocks.restartConnectors,
}));

vi.mock("../../../libs/cloudwatch-lib", () => ({
  sendMetricData: mocks.sendMetricData,
  getMetricSum: mocks.getMetricSum,
}));

process.env.cluster = "cluster-1";
process.env.service = "service-1";
process.env.namespace = "appian-connector-master";

const connectorName = "source.jdbc.appian-connector-dbo-1";

function status(state: string, trace?: string): ConnectorStatus {
  return {
    name: connectorName,
    connector: { state, worker_id: "worker-1" },
    tasks: [{ id: 0, state, worker_id: "worker-1", trace }],
    type: "source",
  };
}

function metricValue(metricName: string): number | undefined {
  for (const [params] of mocks.sendMetricData.mock.calls) {
    const metric = params.MetricData.find((item: { MetricName: string }) => item.MetricName === metricName);
    if (metric) {
      return metric.Value;
    }
  }
  return undefined;
}

function loggedText(): string {
  const log = vi.mocked(console.log);
  return log.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
}

describe("testConnectors heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.sendMetricData.mockResolvedValue(undefined);
    mocks.restartConnectors.mockResolvedValue(undefined);
    mocks.getMetricSum.mockResolvedValue(0);
  });

  it("emits the heartbeat on a successful run", async () => {
    mocks.testConnectors.mockResolvedValue([status("RUNNING")]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(metricValue("health_check_heartbeat")).toBe(1);
  });

  it("emits the heartbeat, a failure metric, and the error message when the worker cannot be reached", async () => {
    mocks.testConnectors.mockRejectedValue(new Error("Could not find worker IP for ECS service"));
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(metricValue("health_check_heartbeat")).toBe(1);
    expect(metricValue(`${connectorName}_failures`)).toBe(1);
    expect(loggedText()).toContain("Could not find worker IP for ECS service");
  });
});
```

- [ ] **Step 2: Run to make sure they fail**

Run: `yarn test-ci health-check`
Expected: FAIL, `health_check_heartbeat` is `undefined`, and the log contains `{}` instead of the message.

- [ ] **Step 3: Implement**

In `testConnectors.ts`, add below `const RUNNING = "RUNNING";`:

```ts
const HEARTBEAT_METRIC = "health_check_heartbeat";
```

Replace the first line of the catch block:

```ts
    console.log("Error caught while testing connectors", e instanceof Error ? e.message : String(e));
```

After the catch block closes, add:

```ts
  } finally {
    await sendMetricData({
      Namespace: namespace,
      MetricData: [{ MetricName: HEARTBEAT_METRIC, Value: 1 }],
    });
  }
```

- [ ] **Step 4: Run tests**

Run: `yarn test-ci`
Expected: PASS, including the existing `oracle-health.test.ts`.

- [ ] **Step 5: Stage (coordinator, after both reviews approve)**

```bash
git add src/services/connector/handlers/testConnectors.ts src/services/connector/tests/health-check.test.ts
```

---

### Task 5: Restart cap and one login attempt per restart

Spec 4.1 and 4.2.

**Files:**
- Modify: `src/libs/cloudwatch-lib.ts`, `src/services/connector/handlers/testConnectors.ts` (whole file below), `src/services/connector/libs/connectors.ts`, `src/services/connector/tests/oracle-health.test.ts` (mock), `src/services/connector/tests/health-check.test.ts`, `src/services/connector/tests/connectors.test.ts`
- Test: `src/libs/tests/cloudwatch-lib.test.ts`

**Interfaces:**
- Consumes: `connectors` (Task 2), `health_check_heartbeat` (Task 4).
- Produces: `getMetricSum(namespace: string, metricName: string, minutes: number): Promise<number>` (throws on CloudWatch errors). Metrics `{name}_restarts` (1 per restart) and `{name}_restart_capped` (0 or 1, every run, every connector). Env var `maxRestartsPerHour` (Task 6 sets `"3"`). Log line `RESTART_CAPPED connector={name} limit={n}`. IAM need: `cloudwatch:GetMetricStatistics` (Task 6).

- [ ] **Step 1: Write the failing `getMetricSum` tests**

`src/libs/tests/cloudwatch-lib.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    send = mocks.send;
  },
  GetMetricStatisticsCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
  PutMetricDataCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

import { getMetricSum } from "../cloudwatch-lib";

describe("getMetricSum", () => {
  beforeEach(() => {
    mocks.send.mockReset();
  });

  it("sums one-minute datapoints over the window", async () => {
    mocks.send.mockResolvedValue({ Datapoints: [{ Sum: 1 }, { Sum: 2 }] });

    await expect(getMetricSum("ns", "m_restarts", 60)).resolves.toBe(3);

    const [command] = mocks.send.mock.calls[0];
    expect(command.input).toMatchObject({ Namespace: "ns", MetricName: "m_restarts", Period: 60, Statistics: ["Sum"] });
    expect(command.input.EndTime.getTime() - command.input.StartTime.getTime()).toBe(60 * 60_000);
  });

  it("returns 0 when there are no datapoints", async () => {
    mocks.send.mockResolvedValue({});
    await expect(getMetricSum("ns", "m", 60)).resolves.toBe(0);
  });

  it("throws when CloudWatch fails", async () => {
    mocks.send.mockRejectedValue(new Error("Throttling"));
    await expect(getMetricSum("ns", "m", 60)).rejects.toThrow("Throttling");
  });
});
```

- [ ] **Step 2: Write the failing restart-cap and config tests**

Append to `src/services/connector/tests/health-check.test.ts`:

```ts
describe("testConnectors restart cap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.sendMetricData.mockResolvedValue(undefined);
    mocks.restartConnectors.mockResolvedValue(undefined);
    mocks.getMetricSum.mockResolvedValue(0);
    delete process.env.maxRestartsPerHour;
  });

  it("restarts below the cap and counts the restart", async () => {
    mocks.testConnectors.mockResolvedValue([status("FAILED")]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(mocks.getMetricSum).toHaveBeenCalledWith("appian-connector-master", `${connectorName}_restarts`, 60);
    expect(mocks.restartConnectors).toHaveBeenCalledTimes(1);
    expect(metricValue(`${connectorName}_restarts`)).toBe(1);
    expect(metricValue(`${connectorName}_restart_capped`)).toBe(0);
  });

  it("does not restart at the default cap of 3", async () => {
    mocks.testConnectors.mockResolvedValue([status("FAILED")]);
    mocks.getMetricSum.mockResolvedValue(3);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(metricValue(`${connectorName}_restart_capped`)).toBe(1);
    expect(loggedText()).toContain(`RESTART_CAPPED connector=${connectorName} limit=3`);
  });

  it("honors maxRestartsPerHour", async () => {
    process.env.maxRestartsPerHour = "1";
    mocks.testConnectors.mockResolvedValue([status("FAILED")]);
    mocks.getMetricSum.mockResolvedValue(1);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(metricValue(`${connectorName}_restart_capped`)).toBe(1);
  });

  it("does not restart when the restart count cannot be read", async () => {
    mocks.testConnectors.mockResolvedValue([status("FAILED")]);
    mocks.getMetricSum.mockRejectedValue(new Error("Throttling"));
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(metricValue(`${connectorName}_restart_capped`)).toBe(1);
  });

  it("does not read the restart count for a running connector", async () => {
    mocks.testConnectors.mockResolvedValue([status("RUNNING")]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(mocks.getMetricSum).not.toHaveBeenCalled();
    expect(metricValue(`${connectorName}_restart_capped`)).toBe(0);
  });

  it("does not restart or count an Oracle auth failure", async () => {
    mocks.testConnectors.mockResolvedValue([status("FAILED", "ORA-01017: invalid username/password")]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(mocks.getMetricSum).not.toHaveBeenCalled();
    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(metricValue(`${connectorName}_restart_capped`)).toBe(0);
  });
});
```

Append to `src/services/connector/tests/connectors.test.ts`, inside the `describe`:

```ts
  it("makes one login attempt per task start", () => {
    for (const connector of connectors) {
      expect(connector.config["connection.attempts"]).toBe(1);
    }
  });
```

In `src/services/connector/tests/oracle-health.test.ts`, add `getMetricSum: vi.fn(),` to the `vi.hoisted` object, change the cloudwatch mock to:

```ts
vi.mock("../../../libs/cloudwatch-lib", () => ({
  sendMetricData: mocks.sendMetricData,
  getMetricSum: mocks.getMetricSum,
}));
```

and add `mocks.getMetricSum.mockResolvedValue(0);` to the `testConnectors oracle health` `beforeEach`.

- [ ] **Step 3: Run to make sure they fail**

Run: `yarn test-ci`
Expected: FAIL. `getMetricSum` is not exported, the restart metrics are `undefined`, and `connection.attempts` is `undefined`.

- [ ] **Step 4: Implement `getMetricSum`**

`src/libs/cloudwatch-lib.ts`:

```ts
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
} from "@aws-sdk/client-cloudwatch";

export async function sendMetricData(params: PutMetricDataCommandInput): Promise<void> {
  // ...unchanged...
}

export async function getMetricSum(namespace: string, metricName: string, minutes: number): Promise<number> {
  const client = new CloudWatchClient({});
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - minutes * 60_000);
  const response = await client.send(
    new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metricName,
      StartTime: startTime,
      EndTime: endTime,
      Period: 60,
      Statistics: ["Sum"],
    })
  );
  return (response.Datapoints ?? []).reduce((total, point) => total + (point.Sum ?? 0), 0);
}
```

- [ ] **Step 5: Implement the cap in `testConnectors.ts`**

Replace the whole file:

```ts
import * as connect from "../../../libs/connect-lib";
import { getMetricSum, sendMetricData } from "../../../libs/cloudwatch-lib";
import type { ConnectorStatus } from "../../../types";
import { connectors } from "../libs/connectors";
import { classifyOracleTaskTraces, formatOracleConnectorLog } from "../libs/oracle-trace";

const RUNNING = "RUNNING";
const HEARTBEAT_METRIC = "health_check_heartbeat";
const DEFAULT_MAX_RESTARTS_PER_HOUR = 3;
const RESTART_WINDOW_MINUTES = 60;

function maxRestartsPerHour(): number {
  const parsed = Number(process.env.maxRestartsPerHour);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_RESTARTS_PER_HOUR;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function putMetric(namespace: string, metricName: string, value: number): Promise<void> {
  await sendMetricData({
    Namespace: namespace,
    MetricData: [{ MetricName: metricName, Value: value }],
  });
}

async function restartLimitReached(namespace: string, connectorName: string, limit: number): Promise<boolean> {
  try {
    return (await getMetricSum(namespace, `${connectorName}_restarts`, RESTART_WINDOW_MINUTES)) >= limit;
  } catch (e) {
    console.log(`Could not read restart count for ${connectorName}`, errorMessage(e));
    return true;
  }
}

// Auth and account-lock failures are never restarted: each restart is another failed Oracle login.
async function restartIfNeeded(
  cluster: string,
  service: string,
  namespace: string,
  result: ConnectorStatus,
  authFailure: boolean
): Promise<boolean> {
  const failing = result.connector.state !== RUNNING || result.tasks.some((task) => task.state !== RUNNING);
  const connector = connectors.find((item) => item.name === result.name);
  if (authFailure || !failing || !connector) {
    return false;
  }

  const limit = maxRestartsPerHour();
  if (await restartLimitReached(namespace, result.name, limit)) {
    console.log(`RESTART_CAPPED connector=${result.name} limit=${limit}`);
    return true;
  }

  await connect.restartConnectors(cluster, service, [connector]);
  await putMetric(namespace, `${result.name}_restarts`, 1);
  return false;
}

export const handler = async function (): Promise<void> {
  const cluster = process.env.cluster;
  const service = process.env.service;
  const namespace = process.env.namespace;

  if (!cluster || !service || !namespace) {
    throw new Error("Environment variables 'cluster', 'service', and 'namespace' are required");
  }

  try {
    const results = await connect.testConnectors(cluster, service, connectors);
    console.log(
      "Kafka connector status results",
      JSON.stringify(
        results.map(({ name, connector, tasks }) => ({
          name,
          connectorState: connector.state,
          tasks: tasks.map(({ id, state }) => ({ id, state })),
        }))
      )
    );

    const classifications = results.map((result) => ({
      result,
      oracle: classifyOracleTaskTraces(result.tasks),
    }));

    for (const { result, oracle } of classifications) {
      if (oracle.oracleClass && oracle.code) {
        console.log(formatOracleConnectorLog(result.name, oracle.code, oracle.oracleClass));
      }
    }

    await Promise.all(classifications.map(({ result }) => putMetric(namespace, `${result.name}_failures`, result.connector.state === RUNNING ? 0 : 1)));

    await Promise.all(
      classifications.map(({ result }) =>
        putMetric(namespace, `${result.name}_task_failures`, result.tasks.every((task) => task.state === RUNNING) ? 0 : 1)
      )
    );

    await Promise.all(
      classifications.map(({ result, oracle }) =>
        sendMetricData({
          Namespace: namespace,
          MetricData: [
            { MetricName: `${result.name}_oracle_auth_failures`, Value: oracle.authFailure ? 1 : 0 },
            { MetricName: `${result.name}_oracle_errors`, Value: oracle.oracleError ? 1 : 0 },
          ],
        })
      )
    );

    for (const { result, oracle } of classifications) {
      const capped = await restartIfNeeded(cluster, service, namespace, result, oracle.authFailure);
      await putMetric(namespace, `${result.name}_restart_capped`, capped ? 1 : 0);
    }
  } catch (e) {
    console.log("Error caught while testing connectors", errorMessage(e));
    await Promise.all(connectors.map((connector) => putMetric(namespace, `${connector.name}_failures`, 1)));
  } finally {
    await putMetric(namespace, HEARTBEAT_METRIC, 1);
  }
};
```

- [ ] **Step 6: One login attempt per restart**

In `src/services/connector/libs/connectors.ts`, add after `"tasks.max": 1,`:

```ts
      "connection.attempts": 1,
```

- [ ] **Step 7: Run tests**

Run: `yarn test-ci && yarn test-tsc`
Expected: PASS, including every existing `oracle-health.test.ts` case.

- [ ] **Step 8: Stage (coordinator, after both reviews approve)**

```bash
git add src/libs/cloudwatch-lib.ts src/libs/tests/cloudwatch-lib.test.ts src/services/connector/handlers/testConnectors.ts \
  src/services/connector/libs/connectors.ts src/services/connector/tests/
```

---

### Task 6: Generated connection alarms, schedule state, and IAM

Spec 3.2–3.5, plus the Phase 2 alarm and permissions.

**Files:**
- Create: `infra/lib/connector-alarms.ts`, `infra/test/fixtures.ts`, `infra/test/connector-alarms.test.ts`
- Modify: `infra/lib/environment-config.ts` (`EnvironmentConfig` and `environmentConfigs`), `infra/lib/appian-connector-stack.ts`, `infra/test/appian-connector-stack.security.test.ts`

**Interfaces:**
- Consumes: `src/services/connector/libs/connector-names.json` (Task 2). Metric names from Tasks 4 and 5.
- Produces: `EnvironmentConfig.healthCheckSchedule: "ENABLED" | "DISABLED"`. `loadConnectorNames(): string[]`. `connectorShortName(name: string): string`. `addConnectorAlarms(scope: Construct, props: ConnectorAlarmsProps): void`. `synthesizeTemplate(overrides?: Partial<FullEnvironmentConfig>): Template` and `baseConfig` in `infra/test/fixtures.ts`. Alarm names `{prefix}-conn-{short}-connector-down|task-down|oracle-auth|restart-capped`, `{prefix}-conn-health-check-missing`, `{prefix}-conn-health-check-errors` (Task 10 parses these).

- [ ] **Step 1: Move the test fixture into `infra/test/fixtures.ts`**

```ts
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AppianConnectorStack } from "../lib/appian-connector-stack";
import { FullEnvironmentConfig } from "../lib/environment-config";

export const baseConfig: FullEnvironmentConfig = {
  stage: "master",
  taskCpu: "1024",
  taskMemory: "2048",
  connectContainerCpu: 512,
  connectContainerMemory: 1024,
  instantClientContainerMemory: 512,
  healthCheckSchedule: "ENABLED",
  vpc: {
    id: "vpc-12345678",
    dataSubnets: ["subnet-data-a", "subnet-data-b", "subnet-data-c"],
    privateSubnets: ["subnet-private-a", "subnet-private-b", "subnet-private-c"],
    publicSubnets: ["subnet-public-a", "subnet-public-b", "subnet-public-c"],
  },
  brokerString: "broker-1:9092,broker-2:9092",
  dbInfo: {
    ip: "127.0.0.1",
    port: "5432",
    db: "appian",
    user: "connector",
    password: "not-a-secret", // pragma: allowlist secret
    schema: "dbo",
  },
  iamPath: "/service-role/",
  iamPermissionsBoundary: "arn:aws:iam::123456789012:policy/Boundary",
  ecrImage: "123456789012.dkr.ecr.us-east-1.amazonaws.com/appian-connector:latest",
};

export function synthesizeTemplate(overrides: Partial<FullEnvironmentConfig> = {}): Template {
  const fullConfig = { ...baseConfig, ...overrides };
  const app = new cdk.App();
  const stack = new AppianConnectorStack(app, `appian-connector-${fullConfig.stage}`, {
    env: { account: "123456789012", region: "us-east-1" },
    fullConfig,
  });
  return Template.fromStack(stack);
}
```

In `appian-connector-stack.security.test.ts`, delete the local `fullConfig` and `synthesizeTemplate`, and the `cdk`, `AppianConnectorStack`, and `FullEnvironmentConfig` imports. Then add `import { synthesizeTemplate } from "./fixtures";`. Replace the body of `it("alarms on oracle auth failures through the existing alerts topic", ...)` with:

```ts
    const template = synthesizeTemplate();
    const alarms = template.findResources("AWS::CloudWatch::Alarm");

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "appian-connector-master-conn-appian-connector-dbo-1-oracle-auth",
      AlarmActions: ["arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-master"],
      OKActions: ["arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-master"],
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      DatapointsToAlarm: 1,
      EvaluationPeriods: 1,
      MetricName: "source.jdbc.appian-connector-dbo-1_oracle_auth_failures",
      Namespace: "appian-connector-master",
      Period: 60,
      Statistic: "Sum",
      Threshold: 1,
      TreatMissingData: "notBreaching",
    });

    const oracleErrorAlarms = Object.values(alarms).filter((alarm) => {
      const metricName = alarm.Properties?.MetricName;
      return typeof metricName === "string" && metricName.includes("oracle_errors");
    });
    expect(oracleErrorAlarms).toHaveLength(0);
```

- [ ] **Step 2: Write the failing alarm tests**

`infra/test/connector-alarms.test.ts`:

```ts
import { Match } from "aws-cdk-lib/assertions";
import { connectorShortName, loadConnectorNames } from "../lib/connector-alarms";
import { environmentConfigs } from "../lib/environment-config";
import { synthesizeTemplate } from "./fixtures";

const topic = "arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-master";

describe("connector alarms", () => {
  it("creates named connection alarms for every connector", () => {
    const template = synthesizeTemplate();
    const names = loadConnectorNames();
    expect(names).toContain("source.jdbc.appian-connector-dbo-1");

    for (const name of names) {
      const short = connectorShortName(name);
      for (const [suffix, metric, statistic] of [
        ["connector-down", `${name}_failures`, "Maximum"],
        ["task-down", `${name}_task_failures`, "Maximum"],
        ["oracle-auth", `${name}_oracle_auth_failures`, "Sum"],
        ["restart-capped", `${name}_restart_capped`, "Maximum"],
      ]) {
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
          AlarmName: `appian-connector-master-conn-${short}-${suffix}`,
          MetricName: metric,
          Namespace: "appian-connector-master",
          Statistic: statistic,
          Period: 60,
          Threshold: 1,
          AlarmActions: [topic],
          OKActions: [topic],
          TreatMissingData: "notBreaching",
        });
      }
    }
  });

  it("waits 3 of 5 minutes before alarming on a down connector or task", () => {
    const template = synthesizeTemplate();
    for (const suffix of ["connector-down", "task-down"]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: `appian-connector-master-conn-appian-connector-dbo-1-${suffix}`,
        DatapointsToAlarm: 3,
        EvaluationPeriods: 5,
      });
    }
  });

  it("no longer references the old connector name", () => {
    const alarms = synthesizeTemplate().findResources("AWS::CloudWatch::Alarm");
    expect(JSON.stringify(alarms)).not.toContain("appian-dbo-1");
  });

  it("alarms when the health check stops reporting, only when the schedule is enabled", () => {
    synthesizeTemplate().hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "appian-connector-master-conn-health-check-missing",
      MetricName: "health_check_heartbeat",
      Statistic: "SampleCount",
      ComparisonOperator: "LessThanThreshold",
      Threshold: 1,
      EvaluationPeriods: 5,
      DatapointsToAlarm: 5,
      TreatMissingData: "breaching",
      AlarmActions: [topic],
      OKActions: [topic],
    });

    const disabled = synthesizeTemplate({ stage: "val", healthCheckSchedule: "DISABLED" });
    const missing = disabled.findResources("AWS::CloudWatch::Alarm", {
      Properties: { AlarmName: "appian-connector-val-conn-health-check-missing" },
    });
    expect(Object.keys(missing)).toHaveLength(0);
  });

  it("alarms on testConnectors Lambda errors", () => {
    synthesizeTemplate().hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "appian-connector-master-conn-health-check-errors",
      Namespace: "AWS/Lambda",
      MetricName: "Errors",
      Dimensions: [{ Name: "FunctionName", Value: "appian-connector-master-testConnectors" }],
      Statistic: "Sum",
      DatapointsToAlarm: 2,
      EvaluationPeriods: 3,
    });
  });

  it("sets the schedule rule state from config", () => {
    synthesizeTemplate().hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "cron(0/1 * ? * * *)", State: "ENABLED" });
    synthesizeTemplate({ stage: "val", healthCheckSchedule: "DISABLED" }).hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(0/1 * ? * * *)",
      State: "DISABLED",
    });
  });

  it("matches the live schedule state per stage", () => {
    expect(environmentConfigs.master.healthCheckSchedule).toBe("ENABLED");
    expect(environmentConfigs.val.healthCheckSchedule).toBe("DISABLED");
    expect(environmentConfigs.production.healthCheckSchedule).toBe("DISABLED");
  });

  it("lets testConnectors read restart counts with a cap of 3", () => {
    const template = synthesizeTemplate();
    template.hasResourceProperties("AWS::IAM::Role", {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([Match.objectLike({ Action: ["cloudwatch:PutMetricData", "cloudwatch:GetMetricStatistics"] })]),
          }),
        }),
      ]),
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "appian-connector-master-testConnectors",
      Environment: { Variables: Match.objectLike({ maxRestartsPerHour: "3" }) },
    });
  });
});
```

- [ ] **Step 3: Run to make sure they fail**

Run: `yarn --cwd infra test`
Expected: FAIL. `../lib/connector-alarms` does not exist, and the fixture has an unknown `healthCheckSchedule` property.

- [ ] **Step 4: Add `healthCheckSchedule` to the environment config**

In `infra/lib/environment-config.ts`, add to `EnvironmentConfig` after `instantClientContainerMemory: number;`:

```ts
  // EventBridge state of the minute testConnectors schedule
  healthCheckSchedule: "ENABLED" | "DISABLED";
```

Add `healthCheckSchedule: "ENABLED",` to `master`, and `healthCheckSchedule: "DISABLED",` to `val` and `production`.

- [ ] **Step 5: Create `infra/lib/connector-alarms.ts`**

```ts
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";

const connectorNamesPath = path.join(__dirname, "../../src/services/connector/libs/connector-names.json");

export function loadConnectorNames(): string[] {
  return Object.values(JSON.parse(fs.readFileSync(connectorNamesPath, "utf-8")) as Record<string, string>);
}

export function connectorShortName(connectorName: string): string {
  return connectorName.replace(/^source\.jdbc\./, "");
}

export interface ConnectorAlarmsProps {
  servicePrefix: string;
  alertsTopicArn: string;
  connectorNames: string[];
  healthCheckScheduleEnabled: boolean;
  testConnectorsFunctionName: string;
}

interface ConnectorMetricAlarm {
  suffix: string;
  metricSuffix: string;
  statistic: "Maximum" | "Sum";
  datapointsToAlarm: number;
  evaluationPeriods: number;
}

const CONNECTOR_METRIC_ALARMS: ConnectorMetricAlarm[] = [
  { suffix: "connector-down", metricSuffix: "failures", statistic: "Maximum", datapointsToAlarm: 3, evaluationPeriods: 5 },
  { suffix: "task-down", metricSuffix: "task_failures", statistic: "Maximum", datapointsToAlarm: 3, evaluationPeriods: 5 },
  { suffix: "oracle-auth", metricSuffix: "oracle_auth_failures", statistic: "Sum", datapointsToAlarm: 1, evaluationPeriods: 1 },
  { suffix: "restart-capped", metricSuffix: "restart_capped", statistic: "Maximum", datapointsToAlarm: 1, evaluationPeriods: 1 },
];

export function addConnectorAlarms(scope: Construct, props: ConnectorAlarmsProps): void {
  const { servicePrefix, alertsTopicArn } = props;
  const namePrefix = `${servicePrefix}-conn`;
  const actions = { alarmActions: [alertsTopicArn], okActions: [alertsTopicArn] };

  for (const connectorName of props.connectorNames) {
    const short = connectorShortName(connectorName);
    for (const alarm of CONNECTOR_METRIC_ALARMS) {
      new cloudwatch.CfnAlarm(scope, `ConnAlarm-${short}-${alarm.suffix}`, {
        ...actions,
        alarmName: `${namePrefix}-${short}-${alarm.suffix}`,
        namespace: servicePrefix,
        metricName: `${connectorName}_${alarm.metricSuffix}`,
        statistic: alarm.statistic,
        period: 60,
        evaluationPeriods: alarm.evaluationPeriods,
        datapointsToAlarm: alarm.datapointsToAlarm,
        threshold: 1,
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        treatMissingData: "notBreaching",
      });
    }
  }

  if (props.healthCheckScheduleEnabled) {
    new cloudwatch.CfnAlarm(scope, "ConnAlarm-health-check-missing", {
      ...actions,
      alarmName: `${namePrefix}-health-check-missing`,
      namespace: servicePrefix,
      metricName: "health_check_heartbeat",
      statistic: "SampleCount",
      period: 60,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      threshold: 1,
      comparisonOperator: "LessThanThreshold",
      treatMissingData: "breaching",
    });
  }

  new cloudwatch.CfnAlarm(scope, "ConnAlarm-health-check-errors", {
    ...actions,
    alarmName: `${namePrefix}-health-check-errors`,
    namespace: "AWS/Lambda",
    metricName: "Errors",
    dimensions: [{ name: "FunctionName", value: props.testConnectorsFunctionName }],
    statistic: "Sum",
    period: 60,
    evaluationPeriods: 3,
    datapointsToAlarm: 2,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    treatMissingData: "notBreaching",
  });
}
```

- [ ] **Step 6: Wire it into the stack**

In `infra/lib/appian-connector-stack.ts`:

1. Add the import: `import { addConnectorAlarms, loadConnectorNames } from "./connector-alarms";`
2. Delete the `jdbcConnectorAlarm`, `jdbcTaskAlarm`, and `jdbcOracleAuthAlarm` blocks (the three `new cloudwatch.CfnAlarm(this, "Jdbc...` resources).
3. In the Lambda execution role, change `Action: ["cloudwatch:PutMetricData"],` to `Action: ["cloudwatch:PutMetricData", "cloudwatch:GetMetricStatistics"],`.
4. In the `testConnectorsLambdaFunction` `environment`, add `maxRestartsPerHour: "3",` after `namespace: servicePrefix,`.
5. In `testConnectorsEventsRuleSchedule1`, change `state: "ENABLED",` to `state: fullConfig.healthCheckSchedule,`.
6. After `testConnectorsLambdaPermissionEventsRuleSchedule1`, add:

```ts
    addConnectorAlarms(this, {
      servicePrefix,
      alertsTopicArn,
      connectorNames: loadConnectorNames(),
      healthCheckScheduleEnabled: fullConfig.healthCheckSchedule === "ENABLED",
      testConnectorsFunctionName: `${servicePrefix}-testConnectors`,
    });
```

- [ ] **Step 7: Run tests and the build**

Run: `yarn --cwd infra test && yarn --cwd infra build`
Expected: all suites PASS. `tsc` exits 0.

- [ ] **Step 8: Check the synthesized diff against master (read-only)**

Run: `cd infra && AWS_SDK_LOAD_CONFIG=1 STAGE_NAME=master AWS_PROFILE=bigmac-dev npx cdk diff appian-connector-master`
Expected: the three `Jdbc*Alarm` resources (`JdbcConnectorAlarm`, `JdbcTaskAlarm`, `JdbcOracleAuthAlarm`) removed. Six `-conn-` alarms added (four for `appian-connector-dbo-1`, `health-check-missing`, `health-check-errors`). IAM policy gains `cloudwatch:GetMetricStatistics`. `testConnectors` gains `maxRestartsPerHour`. No change to the ECS service or task definition. `configureConnectors` code changes only if Task 5 is already applied. Stop and report if the ECS service or task definition would be replaced.

- [ ] **Step 9: Stage (coordinator, after both reviews approve)**

```bash
git add infra/lib/connector-alarms.ts infra/lib/environment-config.ts infra/lib/appian-connector-stack.ts infra/test/
```

---

### Task 7: Docs for Part A

**Files:**
- Modify: `README.md`, `infra/README.md`, `AGENTS.md`, `docs/appian-connector-stability-spec.md`

- [ ] **Step 1: `README.md`**

1. Change `- **Runtime**: Node.js 22.x, TypeScript` to `- **Runtime**: Node.js 24.x, TypeScript`.
2. Add after the Quick Start code block:

````markdown
## Tests

```bash
yarn test-tsc          # type check Lambda code
yarn test-ci           # Lambda unit tests (vitest, src/**/*.test.ts)
yarn --cwd infra test  # CDK stack tests (jest)
```

The `Unit Tests` workflow runs all three on every pull request, and the deploy workflow waits for them.
````

3. Rename `## Alert email subscriptions` to `## Alerts`, and insert before its numbered list:

```markdown
Connection alarms are named `appian-connector-<stage>-conn-...` and are generated for every connector listed in `src/services/connector/libs/connector-names.json`:

- `<connector>-connector-down` and `<connector>-task-down`: not RUNNING for 3 of the last 5 minutes.
- `<connector>-oracle-auth`: Oracle rejected the login or the account is locked. The health check does not restart these.
- `<connector>-restart-capped`: the health check already restarted this connector `maxRestartsPerHour` times (default 3) in the last hour and stopped.
- `health-check-missing`: the minute health check has not reported for 5 minutes (only in stages where the schedule is enabled).
- `health-check-errors`: the health check Lambda is failing.

Each sends an alarm notice and a recovery notice. CPU, memory, and log ERROR/WARN alarms use the same topic. The connector carries little data, so days without new rows are normal and are not alarmed on.

Whether the minute health check runs in a stage is set by `healthCheckSchedule` in `infra/lib/environment-config.ts`.
```

4. In `## Contributing`, replace the qmacbis board sentence with: `Work items for this project are tracked in CMS Enterprise Jira, project [OY2](https://jiraent.cms.gov/projects/OY2).`

- [ ] **Step 2: `infra/README.md`**

Replace `- **CloudWatch Alarms**: Monitoring for errors, warnings, CPU, and memory` with:

```markdown
- **CloudWatch Alarms**: Named `-conn-` connection alarms per connector (built in `lib/connector-alarms.ts`), health check heartbeat and Lambda error alarms, and log error, warning, CPU, and memory alarms
```

- [ ] **Step 3: `AGENTS.md`**

Replace the bullet starting `` - `testConnectors` is scheduled via EventBridge every minute. `` with:

```markdown
- `testConnectors` runs every minute from an EventBridge rule whose state comes from `healthCheckSchedule` in `infra/lib/environment-config.ts`. Master is `ENABLED`. Val and production stay `DISABLED` until Tasks 17 and 18 of `docs/appian-connector-stability-plan.md`; they were disabled because restarts once locked the Oracle user. Stop a scheduled run by disabling that stage's EventBridge rule, not the Lambda, and set `healthCheckSchedule` to match so the next deploy agrees.
```

Replace the bullet starting `` - `testConnectors` emits `{connectorName}_failures` `` with:

```markdown
- `testConnectors` emits `{connectorName}_failures`, `{connectorName}_task_failures`, `{connectorName}_restart_capped` (every run), `{connectorName}_restarts` (only when it restarts), and `health_check_heartbeat` (every run, including caught errors) in namespace `appian-connector-{stage}`. It restarts a connector that is not RUNNING, except on Oracle auth or account-lock traces, at most `maxRestartsPerHour` (Lambda env, default 3) times per hour. If it cannot read the restart count, it does not restart. The connector config sets `connection.attempts` to 1. It cannot push new credentials.
```

Replace the bullet starting `- The connector stack alarms only on` with:

```markdown
- Connection alarms are generated in `infra/lib/connector-alarms.ts` for every name in `src/services/connector/libs/connector-names.json` and named `appian-connector-{stage}-conn-{short}-connector-down`, `-task-down` (Max >= 1, 3 of 5 minutes), `-oracle-auth` (Sum >= 1, 1 of 1), and `-restart-capped`, plus `appian-connector-{stage}-conn-health-check-missing` (only when the schedule is enabled) and `-conn-health-check-errors`. `{short}` is the connector name without `source.jdbc.`. All send alarm and OK notices to `Alerts-appian-alerts-{stage}`. There is no alarm on `{connectorName}_oracle_errors`. CPU, memory, and log ERROR/WARN alarms must not use `-conn-`.
- The connector carries little data, and days without rows are normal. Do not add topic or row freshness alarms.
- Tests: `yarn test-tsc`, `yarn test-ci` (vitest, `src/**/*.test.ts`), and `yarn --cwd infra test` (jest, shared fixture `infra/test/fixtures.ts`). `.github/workflows/unit-tests.yml` runs them on pull requests and before every deploy.
```

- [ ] **Step 4: Spec status**

In `docs/appian-connector-stability-spec.md`, set the status line to `**Status:** Phases 1 and 2 implemented on master. Implementation plan: [appian-connector-stability-plan.md](appian-connector-stability-plan.md)`.

- [ ] **Step 5: Final check and stage**

Run: `yarn test-tsc && yarn test-ci && yarn --cwd infra test`
Expected: all exit 0.

```bash
git add README.md infra/README.md AGENTS.md docs/appian-connector-stability-spec.md
```

---

# Part B: Jira notifier

Continue on the same local `master`, on top of Part A's staged changes. Do not commit or create a branch.

### Task 8: Jira ticket content (pure functions)

**Files:**
- Create: `src/services/connector/libs/jira-ticket-config.ts`, `src/services/connector/libs/jira-events.ts`, `src/services/connector/libs/jira-ticket.ts`
- Test: `src/services/connector/tests/jira-events.test.ts`, `src/services/connector/tests/jira-ticket.test.ts`

**Interfaces:**
- Produces (used by Task 10):
  - `JIRA_TICKET` constants. `type StageLabel = "VAL" | "PROD"`. `parseStageLabel(value: string | undefined): StageLabel`.
  - `type NotifierEvent`, `interface Notice { key; subject; state: "ALARM" | "OK"; reason; time; region; metric? }`, `type AlarmSubject`. `parseAlarmName(alarmName: string, servicePrefix: string): AlarmSubject | undefined`. `subjectTitle(subject: AlarmSubject): string`. `toNotice(event: NotifierEvent, servicePrefix: string): Notice | undefined`. `ECS_WORKER_STOPPED_KEY = "ecs-worker-stopped"`.
  - `ticketSummary(stageLabel, notice): string`, `openTicketsJql(stageLabel): string`, `issueFields(stageLabel, summary, description): Record<string, unknown>`, `ticketDescription(notice, stage): string`, `repeatComment(notice): string`, `recoveryComment(notice): string`, `alarmConsoleUrl(region, alarmName): string`.

- [ ] **Step 1: Write the failing tests**

`src/services/connector/tests/jira-events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAlarmName, subjectTitle, toNotice } from "../libs/jira-events";
import type { AlarmStateChangeEvent, EcsTaskStateChangeEvent } from "../libs/jira-events";

const prefix = "appian-connector-val";

function alarmEvent(alarmName: string, value: string): AlarmStateChangeEvent {
  return {
    "detail-type": "CloudWatch Alarm State Change",
    time: "2026-10-14T19:00:00Z",
    region: "us-east-1",
    detail: {
      alarmName,
      state: { value, reason: "Threshold Crossed: 3 out of the last 5 datapoints", timestamp: "2026-10-14T19:00:48.551+0000" },
      configuration: {
        metrics: [
          {
            metricStat: {
              metric: { namespace: "appian-connector-val", name: "source.jdbc.appian-connector-dbo-1_failures" },
              period: 60,
              stat: "Maximum",
            },
          },
        ],
      },
    },
  };
}

const ecsEvent: EcsTaskStateChangeEvent = {
  "detail-type": "ECS Task State Change",
  time: "2026-10-14T19:05:00Z",
  region: "us-east-1",
  detail: {
    clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/appian-connector-val-connect",
    taskArn: "arn:aws:ecs:us-east-1:123456789012:task/abc",
    lastStatus: "STOPPED",
    stoppedReason: "Essential container in task exited",
    stoppedAt: "2026-10-14T19:04:30Z",
  },
};

describe("parseAlarmName", () => {
  it.each([
    ["connector-down", "appian-connector-dbo-1 connector is not RUNNING"],
    ["task-down", "appian-connector-dbo-1 task is not RUNNING"],
    ["oracle-auth", "appian-connector-dbo-1 Oracle login rejected or account locked"],
    ["restart-capped", "appian-connector-dbo-1 restart limit reached"],
  ])("parses the %s connector alarm", (kind, title) => {
    const subject = parseAlarmName(`${prefix}-conn-appian-connector-dbo-1-${kind}`, prefix);
    expect(subject).toEqual({ type: "connector", kind, short: "appian-connector-dbo-1" });
    expect(subjectTitle(subject!)).toBe(title);
  });

  it.each([
    ["health-check-missing", "Health check has stopped reporting"],
    ["health-check-errors", "Health check Lambda is failing"],
  ])("parses the %s stage alarm", (kind, title) => {
    const subject = parseAlarmName(`${prefix}-conn-${kind}`, prefix);
    expect(subject).toEqual({ type: "stage", kind });
    expect(subjectTitle(subject!)).toBe(title);
  });

  it.each([
    "appian-connector-val-KafkaConnectService-CPUUtilization",
    "appian-connector-master-conn-appian-connector-dbo-1-connector-down",
    "appian-connector-val-conn-appian-connector-dbo-1-something-else",
    "appian-connector-val-conn--connector-down",
  ])("ignores %s", (alarmName) => {
    expect(parseAlarmName(alarmName, prefix)).toBeUndefined();
  });
});

describe("toNotice", () => {
  it("turns an ALARM state change into a notice", () => {
    expect(toNotice(alarmEvent(`${prefix}-conn-appian-connector-dbo-1-connector-down`, "ALARM"), prefix)).toEqual({
      key: `${prefix}-conn-appian-connector-dbo-1-connector-down`,
      subject: { type: "connector", kind: "connector-down", short: "appian-connector-dbo-1" },
      state: "ALARM",
      reason: "Threshold Crossed: 3 out of the last 5 datapoints",
      time: "2026-10-14T19:00:48.551+0000",
      region: "us-east-1",
      metric: "appian-connector-val/source.jdbc.appian-connector-dbo-1_failures (Maximum, period 60 seconds)",
    });
  });

  it("keeps OK state changes", () => {
    expect(toNotice(alarmEvent(`${prefix}-conn-health-check-missing`, "OK"), prefix)?.state).toBe("OK");
  });

  it("ignores INSUFFICIENT_DATA and alarms outside the -conn- prefix", () => {
    expect(toNotice(alarmEvent(`${prefix}-conn-health-check-missing`, "INSUFFICIENT_DATA"), prefix)).toBeUndefined();
    expect(toNotice(alarmEvent(`${prefix}-ConnectorLogsErrorCount`, "ALARM"), prefix)).toBeUndefined();
  });

  it("turns an ECS task-stopped event into a worker-stopped notice", () => {
    const notice = toNotice(ecsEvent, prefix);
    expect(notice).toMatchObject({ key: "ecs-worker-stopped", subject: { type: "ecs-worker-stopped" }, state: "ALARM", time: "2026-10-14T19:04:30Z" });
    expect(notice?.reason).toContain("Essential container in task exited");
    expect(subjectTitle(notice!.subject)).toBe("Kafka Connect worker task stopped");
  });
});
```

`src/services/connector/tests/jira-ticket.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Notice } from "../libs/jira-events";
import { parseStageLabel } from "../libs/jira-ticket-config";
import { alarmConsoleUrl, issueFields, openTicketsJql, recoveryComment, repeatComment, ticketDescription, ticketSummary } from "../libs/jira-ticket";

const notice: Notice = {
  key: "appian-connector-val-conn-appian-connector-dbo-1-connector-down",
  subject: { type: "connector", kind: "connector-down", short: "appian-connector-dbo-1" },
  state: "ALARM",
  reason: "Threshold Crossed",
  time: "2026-10-14T19:00:48.551+0000",
  region: "us-east-1",
  metric: "appian-connector-val/source.jdbc.appian-connector-dbo-1_failures (Maximum, period 60 seconds)",
};

describe("jira ticket content", () => {
  it("builds the summary", () => {
    expect(ticketSummary("VAL", notice)).toBe(
      "[VAL] Appian connector: appian-connector-dbo-1 connector is not RUNNING (appian-connector-val-conn-appian-connector-dbo-1-connector-down)"
    );
  });

  it("finds open tickets by project, labels, and status only", () => {
    expect(openTicketsJql("PROD")).toBe("project = OY2 AND labels = macpro_appian_connector AND labels = PROD AND statusCategory != Done");
  });

  it("sets every required ticket field", () => {
    expect(issueFields("VAL", "summary text", "description text")).toEqual({
      project: { key: "OY2" },
      issuetype: { id: "10100" },
      summary: "summary text",
      description: "description text",
      labels: ["macpro_appian_connector", "VAL"],
      components: [{ id: "67202" }, { id: "78303" }],
      customfield_10100: "OY2-29580",
      customfield_26713: [{ id: "51914" }],
      reporter: { name: "PEIT" },
      assignee: { name: "PEIT" },
    });
  });

  it("describes the alarm with times, a console link, and the runbook", () => {
    const description = ticketDescription(notice, "val");
    expect(description).toContain("*Stage:* val");
    expect(description).toContain("*Reason:* Threshold Crossed");
    expect(description).toContain("2026-10-14T19:00:48.551Z UTC (Oct 14, 2026, 3:00 PM Eastern)");
    expect(description).toContain(alarmConsoleUrl("us-east-1", notice.key));
    expect(description).toContain("https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947");
  });

  it("omits the alarm link for an ECS worker-stopped notice", () => {
    const ecsNotice: Notice = { ...notice, key: "ecs-worker-stopped", subject: { type: "ecs-worker-stopped" }, metric: undefined };
    expect(ticketDescription(ecsNotice, "val")).not.toContain("cloudwatch/home");
  });

  it("writes repeat and recovery comments", () => {
    expect(repeatComment(notice)).toContain("Fired again at 2026-10-14T19:00:48.551Z UTC");
    expect(recoveryComment({ ...notice, state: "OK" })).toContain("Recovered at 2026-10-14T19:00:48.551Z UTC");
  });

  it("encodes the alarm name in the console link", () => {
    expect(alarmConsoleUrl("us-east-1", "a b")).toBe("https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:alarm/a%20b");
  });

  it("accepts only VAL or PROD", () => {
    expect(parseStageLabel("VAL")).toBe("VAL");
    expect(parseStageLabel("PROD")).toBe("PROD");
    expect(() => parseStageLabel("DEV")).toThrow("jiraStageLabel must be VAL or PROD");
    expect(() => parseStageLabel(undefined)).toThrow("jiraStageLabel must be VAL or PROD");
  });
});
```

- [ ] **Step 2: Run to make sure they fail**

Run: `yarn test-ci jira-`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `jira-ticket-config.ts`**

```ts
export const JIRA_TICKET = {
  projectKey: "OY2",
  issueTypeId: "10100",
  epicLinkField: "customfield_10100",
  epicKey: "OY2-29580",
  componentIds: ["67202", "78303"],
  workingTeamField: "customfield_26713",
  workingTeamOptionId: "51914",
  reporter: "PEIT",
  assignee: "PEIT",
  label: "macpro_appian_connector",
  runbookUrl: "https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947",
} as const;

export type StageLabel = "VAL" | "PROD";

export function parseStageLabel(value: string | undefined): StageLabel {
  if (value === "VAL" || value === "PROD") {
    return value;
  }
  throw new Error(`jiraStageLabel must be VAL or PROD, got ${value ?? "nothing"}`);
}
```

- [ ] **Step 4: Implement `jira-events.ts`**

```ts
export type ConnectorAlarmKind = "connector-down" | "task-down" | "oracle-auth" | "restart-capped";
export type StageAlarmKind = "health-check-missing" | "health-check-errors";

const CONNECTOR_ALARM_KINDS: readonly ConnectorAlarmKind[] = ["connector-down", "task-down", "oracle-auth", "restart-capped"];
const STAGE_ALARM_KINDS: readonly StageAlarmKind[] = ["health-check-missing", "health-check-errors"];

export const ECS_WORKER_STOPPED_KEY = "ecs-worker-stopped";

export type AlarmSubject =
  | { type: "connector"; kind: ConnectorAlarmKind; short: string }
  | { type: "stage"; kind: StageAlarmKind }
  | { type: "ecs-worker-stopped" };

export interface AlarmStateChangeEvent {
  "detail-type": "CloudWatch Alarm State Change";
  time: string;
  region: string;
  detail: {
    alarmName: string;
    state: { value: string; reason: string; timestamp?: string };
    configuration?: {
      metrics?: Array<{ metricStat?: { metric?: { namespace?: string; name?: string }; period?: number; stat?: string } }>;
    };
  };
}

export interface EcsTaskStateChangeEvent {
  "detail-type": "ECS Task State Change";
  time: string;
  region: string;
  detail: { clusterArn: string; taskArn?: string; lastStatus: string; stoppedReason?: string; stoppedAt?: string };
}

export type NotifierEvent = AlarmStateChangeEvent | EcsTaskStateChangeEvent;

export interface Notice {
  key: string;
  subject: AlarmSubject;
  state: "ALARM" | "OK";
  reason: string;
  time: string;
  region: string;
  metric?: string;
}

export function parseAlarmName(alarmName: string, servicePrefix: string): AlarmSubject | undefined {
  const marker = `${servicePrefix}-conn-`;
  if (!alarmName.startsWith(marker)) {
    return undefined;
  }
  const rest = alarmName.slice(marker.length);

  const stageKind = STAGE_ALARM_KINDS.find((kind) => rest === kind);
  if (stageKind) {
    return { type: "stage", kind: stageKind };
  }

  const connectorKind = CONNECTOR_ALARM_KINDS.find((kind) => rest.endsWith(`-${kind}`));
  if (!connectorKind) {
    return undefined;
  }
  const short = rest.slice(0, -(connectorKind.length + 1));
  return short ? { type: "connector", kind: connectorKind, short } : undefined;
}

function connectorAlarmTitle(kind: ConnectorAlarmKind, short: string): string {
  switch (kind) {
    case "connector-down":
      return `${short} connector is not RUNNING`;
    case "task-down":
      return `${short} task is not RUNNING`;
    case "oracle-auth":
      return `${short} Oracle login rejected or account locked`;
    case "restart-capped":
      return `${short} restart limit reached`;
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled connector alarm kind ${String(unhandled)}`);
    }
  }
}

function stageAlarmTitle(kind: StageAlarmKind): string {
  switch (kind) {
    case "health-check-missing":
      return "Health check has stopped reporting";
    case "health-check-errors":
      return "Health check Lambda is failing";
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled stage alarm kind ${String(unhandled)}`);
    }
  }
}

export function subjectTitle(subject: AlarmSubject): string {
  switch (subject.type) {
    case "connector":
      return connectorAlarmTitle(subject.kind, subject.short);
    case "stage":
      return stageAlarmTitle(subject.kind);
    case "ecs-worker-stopped":
      return "Kafka Connect worker task stopped";
    default: {
      const unhandled: never = subject;
      throw new Error(`Unhandled alarm subject ${JSON.stringify(unhandled)}`);
    }
  }
}

export function toNotice(event: NotifierEvent, servicePrefix: string): Notice | undefined {
  switch (event["detail-type"]) {
    case "CloudWatch Alarm State Change": {
      const subject = parseAlarmName(event.detail.alarmName, servicePrefix);
      const state = event.detail.state.value;
      if (!subject || (state !== "ALARM" && state !== "OK")) {
        return undefined;
      }
      const metricStat = event.detail.configuration?.metrics?.[0]?.metricStat;
      return {
        key: event.detail.alarmName,
        subject,
        state,
        reason: event.detail.state.reason,
        time: event.detail.state.timestamp ?? event.time,
        region: event.region,
        metric: metricStat?.metric?.name
          ? `${metricStat.metric.namespace}/${metricStat.metric.name} (${metricStat.stat}, period ${metricStat.period} seconds)`
          : undefined,
      };
    }
    case "ECS Task State Change":
      return {
        key: ECS_WORKER_STOPPED_KEY,
        subject: { type: "ecs-worker-stopped" },
        state: "ALARM",
        reason: `Task ${event.detail.taskArn ?? "unknown"} stopped: ${event.detail.stoppedReason ?? "no reason given"}`,
        time: event.detail.stoppedAt ?? event.time,
        region: event.region,
      };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled event ${JSON.stringify(unhandled)}`);
    }
  }
}
```

- [ ] **Step 5: Implement `jira-ticket.ts`**

```ts
import { subjectTitle } from "./jira-events";
import type { Notice } from "./jira-events";
import { JIRA_TICKET } from "./jira-ticket-config";
import type { StageLabel } from "./jira-ticket-config";

function formatTimes(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const eastern = date.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
  return `${date.toISOString()} UTC (${eastern} Eastern)`;
}

export function alarmConsoleUrl(region: string, alarmName: string): string {
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#alarmsV2:alarm/${encodeURIComponent(alarmName)}`;
}

export function ticketSummary(stageLabel: StageLabel, notice: Notice): string {
  return `[${stageLabel}] Appian connector: ${subjectTitle(notice.subject)} (${notice.key})`;
}

export function openTicketsJql(stageLabel: StageLabel): string {
  return `project = ${JIRA_TICKET.projectKey} AND labels = ${JIRA_TICKET.label} AND labels = ${stageLabel} AND statusCategory != Done`;
}

export function issueFields(stageLabel: StageLabel, summary: string, description: string): Record<string, unknown> {
  return {
    project: { key: JIRA_TICKET.projectKey },
    issuetype: { id: JIRA_TICKET.issueTypeId },
    summary,
    description,
    labels: [JIRA_TICKET.label, stageLabel],
    components: JIRA_TICKET.componentIds.map((id) => ({ id })),
    [JIRA_TICKET.epicLinkField]: JIRA_TICKET.epicKey,
    [JIRA_TICKET.workingTeamField]: [{ id: JIRA_TICKET.workingTeamOptionId }],
    reporter: { name: JIRA_TICKET.reporter },
    assignee: { name: JIRA_TICKET.assignee },
  };
}

export function ticketDescription(notice: Notice, stage: string): string {
  const lines = [
    `*What:* ${subjectTitle(notice.subject)}`,
    `*Stage:* ${stage}`,
    `*Source:* ${notice.key}`,
    `*State:* ${notice.state}`,
    `*Reason:* ${notice.reason}`,
    ...(notice.metric ? [`*Metric:* ${notice.metric}`] : []),
    `*Time:* ${formatTimes(notice.time)}`,
    ...(notice.subject.type === "ecs-worker-stopped" ? [] : [`*Alarm:* [CloudWatch|${alarmConsoleUrl(notice.region, notice.key)}]`]),
    `*Runbook:* [MACPro Appian Connector runbook|${JIRA_TICKET.runbookUrl}]`,
  ];
  return lines.join("\n");
}

export function repeatComment(notice: Notice): string {
  return `Fired again at ${formatTimes(notice.time)}.\n*Reason:* ${notice.reason}`;
}

export function recoveryComment(notice: Notice): string {
  return `Recovered at ${formatTimes(notice.time)}. Leaving this ticket open for review.\n*Reason:* ${notice.reason}`;
}
```

- [ ] **Step 6: Run tests**

Run: `yarn test-ci jira- && yarn test-tsc`
Expected: PASS.

- [ ] **Step 7: Stage (coordinator, after both reviews approve)**

```bash
git add src/services/connector/libs/jira-ticket-config.ts src/services/connector/libs/jira-events.ts src/services/connector/libs/jira-ticket.ts \
  src/services/connector/tests/jira-events.test.ts src/services/connector/tests/jira-ticket.test.ts
```

---

### Task 9: Jira client and secret loading

Spec 5.2 and 5.4.

**Files:**
- Create: `src/services/connector/libs/jira-client.ts`
- Modify: `src/services/connector/package.json`, `yarn.lock` (dependency)
- Test: `src/services/connector/tests/jira-client.test.ts`

**Interfaces:**
- Produces: `interface JiraCredentials { url: string; token: string }`, `interface JiraIssueSummary { key: string; summary: string }`, `loadJiraCredentials(secretId: string): Promise<JiraCredentials>` (cached per container, trailing slash removed), `clearJiraCredentialsCache(): void`, `searchIssues(credentials, jql): Promise<JiraIssueSummary[]>`, `createIssue(credentials, fields): Promise<string>` (issue key), `addComment(credentials, issueKey, body): Promise<void>`. All throw on non-2xx or after 10 seconds.

- [ ] **Step 1: Add the dependency**

Run: `yarn workspace connector add @aws-sdk/client-secrets-manager@^3.1047.0`
Expected: `src/services/connector/package.json` lists it. `yarn.lock` updated.

- [ ] **Step 2: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mocks.send;
  },
  GetSecretValueCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

import { addComment, clearJiraCredentialsCache, createIssue, loadJiraCredentials, searchIssues } from "../libs/jira-client";

const credentials = { url: "https://jira.example.test", token: "test-token" };
const fetchMock = vi.fn();

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("jira client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mocks.send.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clearJiraCredentialsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the secret once, trims a trailing slash, and caches it", async () => {
    mocks.send.mockResolvedValue({ SecretString: JSON.stringify({ url: "https://jira.example.test/", token: "test-token" }) });

    await expect(loadJiraCredentials("appian/val/jira")).resolves.toEqual(credentials);
    await loadJiraCredentials("appian/val/jira");

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].input).toEqual({ SecretId: "appian/val/jira" });
  });

  it("rejects a secret without a token and does not cache the failure", async () => {
    mocks.send.mockResolvedValueOnce({ SecretString: JSON.stringify({ url: "https://jira.example.test" }) });
    await expect(loadJiraCredentials("appian/val/jira")).rejects.toThrow("must be JSON with non-empty url and token");

    mocks.send.mockResolvedValueOnce({ SecretString: JSON.stringify(credentials) });
    await expect(loadJiraCredentials("appian/val/jira")).resolves.toEqual(credentials);
  });

  it("searches with the bearer token and the JQL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { issues: [{ key: "OY2-1", fields: { summary: "s" } }] }));

    await expect(searchIssues(credentials, "project = OY2")).resolves.toEqual([{ key: "OY2-1", summary: "s" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jira.example.test/rest/api/2/search?jql=project+%3D+OY2&fields=summary&maxResults=100");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("creates an issue and returns its key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { key: "OY2-2" }));

    await expect(createIssue(credentials, { summary: "s" })).resolves.toBe("OY2-2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jira.example.test/rest/api/2/issue");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ fields: { summary: "s" } });
  });

  it("adds a comment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "1" }));

    await addComment(credentials, "OY2-2", "hello");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jira.example.test/rest/api/2/issue/OY2-2/comment");
    expect(JSON.parse(init.body)).toEqual({ body: "hello" });
  });

  it("throws on a non-2xx response without exposing the token", async () => {
    fetchMock.mockResolvedValue(new Response('{"errors":{"customfield_10100":"bad epic"}}', { status: 400 }));

    const error = await createIssue(credentials, { summary: "s" }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("returned 400");
    expect((error as Error).message).toContain("bad epic");
    expect((error as Error).message).not.toContain("test-token");
  });
});
```

- [ ] **Step 3: Run to make sure they fail**

Run: `yarn test-ci jira-client`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `jira-client.ts`**

```ts
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface JiraCredentials {
  url: string;
  token: string;
}

export interface JiraIssueSummary {
  key: string;
  summary: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

let cachedCredentials: Promise<JiraCredentials> | undefined;

async function readCredentials(secretId: string): Promise<JiraCredentials> {
  const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
  const parsed = JSON.parse(response.SecretString ?? "{}") as Partial<JiraCredentials>;
  if (typeof parsed.url !== "string" || typeof parsed.token !== "string" || parsed.url === "" || parsed.token === "") {
    throw new Error(`Secret ${secretId} must be JSON with non-empty url and token`);
  }
  return { url: parsed.url.replace(/\/+$/, ""), token: parsed.token };
}

export function loadJiraCredentials(secretId: string): Promise<JiraCredentials> {
  cachedCredentials ??= readCredentials(secretId).catch((error: unknown) => {
    cachedCredentials = undefined;
    throw error;
  });
  return cachedCredentials;
}

export function clearJiraCredentialsCache(): void {
  cachedCredentials = undefined;
}

async function jiraRequest<T>(credentials: JiraCredentials, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${credentials.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${credentials.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Jira ${method} ${path.split("?")[0]} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

export async function searchIssues(credentials: JiraCredentials, jql: string): Promise<JiraIssueSummary[]> {
  const query = new URLSearchParams({ jql, fields: "summary", maxResults: "100" });
  const data = await jiraRequest<{ issues: Array<{ key: string; fields: { summary: string } }> }>(
    credentials,
    "GET",
    `/rest/api/2/search?${query.toString()}`
  );
  return data.issues.map((issue) => ({ key: issue.key, summary: issue.fields.summary }));
}

export async function createIssue(credentials: JiraCredentials, fields: Record<string, unknown>): Promise<string> {
  const data = await jiraRequest<{ key: string }>(credentials, "POST", "/rest/api/2/issue", { fields });
  return data.key;
}

export async function addComment(credentials: JiraCredentials, issueKey: string, body: string): Promise<void> {
  await jiraRequest<unknown>(credentials, "POST", `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`, { body });
}
```

- [ ] **Step 5: Run tests**

Run: `yarn test-ci jira-client && yarn test-tsc`
Expected: PASS.

- [ ] **Step 6: Stage (coordinator, after both reviews approve)**

```bash
git add src/services/connector/libs/jira-client.ts src/services/connector/tests/jira-client.test.ts src/services/connector/package.json yarn.lock
```

---

### Task 10: `jiraNotifier` handler

Spec 5.4.

**Files:**
- Create: `src/services/connector/handlers/jiraNotifier.ts`
- Test: `src/services/connector/tests/jira-notifier.test.ts`

**Interfaces:**
- Consumes: everything Task 8 and Task 9 produce.
- Produces: `handler(event: NotifierEvent): Promise<void>`. Env vars (Task 11 sets them): `stage`, `servicePrefix`, `jiraStageLabel`, `jiraSecretId`. Log lines `JIRA_TICKET_CREATED key=... source=...`, `JIRA_TICKET_COMMENTED ...`, `JIRA_TICKET_RECOVERED ...`, `JIRA_NOTIFIER_IGNORED ...`.

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlarmStateChangeEvent, EcsTaskStateChangeEvent } from "../libs/jira-events";

const mocks = vi.hoisted(() => ({
  loadJiraCredentials: vi.fn(),
  searchIssues: vi.fn(),
  createIssue: vi.fn(),
  addComment: vi.fn(),
}));

vi.mock("../libs/jira-client", () => mocks);

process.env.stage = "val";
process.env.servicePrefix = "appian-connector-val";
process.env.jiraStageLabel = "VAL";
process.env.jiraSecretId = "appian/val/jira";

const alarmName = "appian-connector-val-conn-appian-connector-dbo-1-connector-down";
const summary = `[VAL] Appian connector: appian-connector-dbo-1 connector is not RUNNING (${alarmName})`;

function alarmEvent(value: string, name = alarmName): AlarmStateChangeEvent {
  return {
    "detail-type": "CloudWatch Alarm State Change",
    time: "2026-10-14T19:00:00Z",
    region: "us-east-1",
    detail: { alarmName: name, state: { value, reason: "Threshold Crossed", timestamp: "2026-10-14T19:00:48.551+0000" } },
  };
}

const ecsEvent: EcsTaskStateChangeEvent = {
  "detail-type": "ECS Task State Change",
  time: "2026-10-14T19:05:00Z",
  region: "us-east-1",
  detail: { clusterArn: "arn:aws:ecs:us-east-1:123456789012:cluster/c", lastStatus: "STOPPED", stoppedReason: "Essential container in task exited" },
};

describe("jiraNotifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.jiraStageLabel = "VAL";
    mocks.loadJiraCredentials.mockResolvedValue({ url: "https://jira.example.test", token: "test-token" });
    mocks.searchIssues.mockResolvedValue([]);
    mocks.createIssue.mockResolvedValue("OY2-100");
    mocks.addComment.mockResolvedValue(undefined);
  });

  it("creates a ticket with every required field when none is open", async () => {
    const { handler } = await import("../handlers/jiraNotifier");

    await handler(alarmEvent("ALARM"));

    expect(mocks.loadJiraCredentials).toHaveBeenCalledWith("appian/val/jira");
    expect(mocks.searchIssues).toHaveBeenCalledWith(
      expect.anything(),
      "project = OY2 AND labels = macpro_appian_connector AND labels = VAL AND statusCategory != Done"
    );
    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
    const fields = mocks.createIssue.mock.calls[0][1];
    expect(fields).toMatchObject({
      project: { key: "OY2" },
      issuetype: { id: "10100" },
      summary,
      labels: ["macpro_appian_connector", "VAL"],
      components: [{ id: "67202" }, { id: "78303" }],
      customfield_10100: "OY2-29580",
      customfield_26713: [{ id: "51914" }],
      reporter: { name: "PEIT" },
      assignee: { name: "PEIT" },
    });
    expect(JSON.stringify(mocks.createIssue.mock.calls)).not.toContain("test-token");
    expect(mocks.addComment).not.toHaveBeenCalled();
  });

  it("comments instead of creating when the same ticket is open", async () => {
    mocks.searchIssues.mockResolvedValue([{ key: "OY2-7", summary }]);
    const { handler } = await import("../handlers/jiraNotifier");

    await handler(alarmEvent("ALARM"));

    expect(mocks.addComment).toHaveBeenCalledWith(expect.anything(), "OY2-7", expect.stringContaining("Fired again"));
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });

  it("ignores an open ticket with a different summary", async () => {
    mocks.searchIssues.mockResolvedValue([{ key: "OY2-8", summary: `${summary} (old)` }]);
    const { handler } = await import("../handlers/jiraNotifier");

    await handler(alarmEvent("ALARM"));

    expect(mocks.createIssue).toHaveBeenCalledTimes(1);
  });

  it("comments on recovery and leaves the ticket open", async () => {
    mocks.searchIssues.mockResolvedValue([{ key: "OY2-7", summary }]);
    const { handler } = await import("../handlers/jiraNotifier");

    await handler(alarmEvent("OK"));

    expect(mocks.addComment).toHaveBeenCalledWith(expect.anything(), "OY2-7", expect.stringContaining("Recovered at"));
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });

  it("does nothing on recovery when no ticket is open", async () => {
    const { handler } = await import("../handlers/jiraNotifier");

    await handler(alarmEvent("OK"));

    expect(mocks.addComment).not.toHaveBeenCalled();
    expect(mocks.createIssue).not.toHaveBeenCalled();
  });

  it("creates a worker-stopped ticket for an ECS event", async () => {
    const { handler } = await import("../handlers/jiraNotifier");

    await handler(ecsEvent);

    const fields = mocks.createIssue.mock.calls[0][1];
    expect(fields.summary).toBe("[VAL] Appian connector: Kafka Connect worker task stopped (ecs-worker-stopped)");
    expect(fields.description).toContain("Essential container in task exited");
  });

  it("ignores alarms outside the -conn- prefix without calling Jira", async () => {
    const { handler } = await import("../handlers/jiraNotifier");

    await handler(alarmEvent("ALARM", "appian-connector-val-KafkaConnectService-CPUUtilization"));

    expect(mocks.loadJiraCredentials).not.toHaveBeenCalled();
  });

  it("fails so Lambda retries when Jira rejects the request", async () => {
    mocks.createIssue.mockRejectedValue(new Error("Jira POST /rest/api/2/issue returned 500"));
    const { handler } = await import("../handlers/jiraNotifier");

    await expect(handler(alarmEvent("ALARM"))).rejects.toThrow("returned 500");
  });

  it("refuses to run without a VAL or PROD label", async () => {
    process.env.jiraStageLabel = "DEV";
    const { handler } = await import("../handlers/jiraNotifier");

    await expect(handler(alarmEvent("ALARM"))).rejects.toThrow("jiraStageLabel must be VAL or PROD");
  });
});
```

- [ ] **Step 2: Run to make sure they fail**

Run: `yarn test-ci jira-notifier`
Expected: FAIL, `../handlers/jiraNotifier` not found.

- [ ] **Step 3: Implement**

```ts
import { addComment, createIssue, loadJiraCredentials, searchIssues } from "../libs/jira-client";
import { toNotice } from "../libs/jira-events";
import type { NotifierEvent } from "../libs/jira-events";
import { issueFields, openTicketsJql, recoveryComment, repeatComment, ticketDescription, ticketSummary } from "../libs/jira-ticket";
import { parseStageLabel } from "../libs/jira-ticket-config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable '${name}' is required`);
  }
  return value;
}

export const handler = async function (event: NotifierEvent): Promise<void> {
  const stage = requireEnv("stage");
  const servicePrefix = requireEnv("servicePrefix");
  const secretId = requireEnv("jiraSecretId");
  const stageLabel = parseStageLabel(process.env.jiraStageLabel);

  const notice = toNotice(event, servicePrefix);
  if (!notice) {
    console.log("JIRA_NOTIFIER_IGNORED", JSON.stringify({ detailType: event["detail-type"] }));
    return;
  }

  const credentials = await loadJiraCredentials(secretId);
  const summary = ticketSummary(stageLabel, notice);
  const openTicket = (await searchIssues(credentials, openTicketsJql(stageLabel))).find((issue) => issue.summary === summary);

  if (notice.state === "OK") {
    if (openTicket) {
      await addComment(credentials, openTicket.key, recoveryComment(notice));
      console.log(`JIRA_TICKET_RECOVERED key=${openTicket.key} source=${notice.key}`);
    }
    return;
  }

  if (openTicket) {
    await addComment(credentials, openTicket.key, repeatComment(notice));
    console.log(`JIRA_TICKET_COMMENTED key=${openTicket.key} source=${notice.key}`);
    return;
  }

  const key = await createIssue(credentials, issueFields(stageLabel, summary, ticketDescription(notice, stage)));
  console.log(`JIRA_TICKET_CREATED key=${key} source=${notice.key}`);
};
```

- [ ] **Step 4: Run tests**

Run: `yarn test-ci && yarn test-tsc`
Expected: PASS.

- [ ] **Step 5: Stage (coordinator, after both reviews approve)**

```bash
git add src/services/connector/handlers/jiraNotifier.ts src/services/connector/tests/jira-notifier.test.ts
```

---

### Task 11: Notifier infrastructure (val and production only)

Spec 5.1.

**Files:**
- Create: `infra/lib/jira-notifier.ts`, `infra/test/jira-notifier.test.ts`
- Modify: `infra/lib/environment-config.ts`, `infra/lib/appian-connector-stack.ts`, `infra/test/fixtures.ts`

**Interfaces:**
- Consumes: `handlers/jiraNotifier.ts` (Task 10), `-conn-` alarm names (Task 6), `ECSFailureEventRule`.
- Produces: `EnvironmentConfig.jiraStageLabel: "VAL" | "PROD" | null`. `class JiraNotifier extends Construct { readonly function: NodejsFunction }`. Resources: `{prefix}-jiraNotifier` Lambda, `{prefix}-jiraNotifier-dlq` queue, `{prefix}-jiraNotifier-dlq` alarm.

- [ ] **Step 1: Add `jiraStageLabel` to the fixture and write the failing tests**

In `infra/test/fixtures.ts`, add `jiraStageLabel: null,` after `healthCheckSchedule: "ENABLED",`.

`infra/test/jira-notifier.test.ts`:

```ts
import { Match, Template } from "aws-cdk-lib/assertions";
import { environmentConfigs } from "../lib/environment-config";
import { synthesizeTemplate } from "./fixtures";

function ecsFailureRule(template: Template) {
  return Object.values(template.findResources("AWS::Events::Rule")).find(
    (rule) => rule.Properties.Description === "Connector Task Failure Event Rule"
  );
}

describe("jira notifier", () => {
  it("is configured for val and production only", () => {
    expect(environmentConfigs.master.jiraStageLabel).toBeNull();
    expect(environmentConfigs.val.jiraStageLabel).toBe("VAL");
    expect(environmentConfigs.production.jiraStageLabel).toBe("PROD");
  });

  it("is not created when jiraStageLabel is null", () => {
    const template = synthesizeTemplate();
    expect(Object.keys(template.findResources("AWS::SQS::Queue"))).toHaveLength(0);
    expect(JSON.stringify(template.findResources("AWS::Lambda::Function"))).not.toContain("jiraNotifier");
    expect(ecsFailureRule(template)?.Properties.Targets).toHaveLength(1);
  });

  describe("in val", () => {
    let template: Template;

    beforeAll(() => {
      template = synthesizeTemplate({ stage: "val", healthCheckSchedule: "DISABLED", jiraStageLabel: "VAL" });
    });

    it("creates the notifier with serialized concurrency and the Jira settings", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "appian-connector-val-jiraNotifier",
        Runtime: "nodejs24.x",
        ReservedConcurrentExecutions: 1,
        Timeout: 30,
        Environment: {
          Variables: {
            stage: "val",
            servicePrefix: "appian-connector-val",
            jiraStageLabel: "VAL",
            jiraSecretId: "appian/val/jira",
          },
        },
      });
    });

    it("retries twice, then sends the event to an encrypted dead-letter queue that alarms to email", () => {
      template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
        MaximumRetryAttempts: 2,
        DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
      });
      template.hasResourceProperties("AWS::SQS::Queue", { QueueName: "appian-connector-val-jiraNotifier-dlq", SqsManagedSseEnabled: true });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: "appian-connector-val-jiraNotifier-dlq",
        Namespace: "AWS/SQS",
        MetricName: "ApproximateNumberOfMessagesVisible",
        AlarmActions: ["arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-val"],
      });
    });

    it("listens only to connection alarms entering ALARM or OK", () => {
      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: {
          source: ["aws.cloudwatch"],
          "detail-type": ["CloudWatch Alarm State Change"],
          detail: { alarmName: [{ prefix: "appian-connector-val-conn-" }], state: { value: ["ALARM", "OK"] } },
        },
      });
    });

    it("also receives ECS task-stopped events", () => {
      const targets = ecsFailureRule(template)?.Properties.Targets;
      expect(targets).toHaveLength(2);
      expect(targets).toEqual(expect.arrayContaining([expect.objectContaining({ Id: "JiraNotifierEcsTaskFailure" })]));
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Principal: "events.amazonaws.com",
        SourceArn: { "Fn::GetAtt": ["ECSFailureEventRule", "Arn"] },
      });
    });

    it("can read only its own Jira secret", () => {
      const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
      expect(policies).toContain("secretsmanager:GetSecretValue");
      expect(policies).toContain("secret:appian/val/jira-*");
      expect(policies).not.toContain("secret:*");
    });

    it("keeps CPU, memory, and log-count alarms out of the -conn- prefix", () => {
      for (const alarm of Object.values(template.findResources("AWS::CloudWatch::Alarm"))) {
        const name = alarm.Properties.AlarmName;
        if (typeof name === "string" && /CPUUtilization|MemoryUtilization|ConnectorLogs/.test(name)) {
          expect(name).not.toContain("-conn-");
        }
      }
    });
  });

  it("labels production tickets PROD", () => {
    synthesizeTemplate({ stage: "production", healthCheckSchedule: "DISABLED", jiraStageLabel: "PROD" }).hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "appian-connector-production-jiraNotifier",
      Environment: { Variables: Match.objectLike({ jiraStageLabel: "PROD", jiraSecretId: "appian/production/jira" }) },
    });
  });
});
```

- [ ] **Step 2: Run to make sure they fail**

Run: `yarn --cwd infra test jira-notifier`
Expected: FAIL. The fixture has an unknown property `jiraStageLabel`, and there is no notifier.

- [ ] **Step 3: Add `jiraStageLabel` to the environment config**

In `EnvironmentConfig`, after `healthCheckSchedule`:

```ts
  // Jira ticket label for this stage; null means no Jira notifier is deployed
  jiraStageLabel: "VAL" | "PROD" | null;
```

Set `jiraStageLabel: null,` on master, `jiraStageLabel: "VAL",` on val, and `jiraStageLabel: "PROD",` on production.

- [ ] **Step 4: Create `infra/lib/jira-notifier.ts`**

```ts
import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import * as path from "node:path";
import type { VpcConfig } from "./environment-config";

export interface JiraNotifierProps {
  stage: string;
  servicePrefix: string;
  stageLabel: "VAL" | "PROD";
  alertsTopicArn: string;
  handlersPath: string;
  vpc: VpcConfig;
  securityGroupId: string;
  logsKey: kms.IKey;
  iamPath: string;
  iamPermissionsBoundary: string;
}

export class JiraNotifier extends Construct {
  public readonly function: NodejsFunction;

  public constructor(scope: Construct, id: string, props: JiraNotifierProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const functionName = `${props.servicePrefix}-jiraNotifier`;
    const secretId = `appian/${props.stage}/jira`;

    const deadLetterQueue = new sqs.Queue(this, "DeadLetterQueue", {
      queueName: `${functionName}-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const role = new iam.Role(this, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      path: props.iamPath,
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyArn(this, "PermissionsBoundary", props.iamPermissionsBoundary),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole")],
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [`arn:${stack.partition}:secretsmanager:${stack.region}:${stack.account}:secret:${secretId}-*`],
      })
    );

    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${functionName}`,
      encryptionKey: props.logsKey,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    this.function = new NodejsFunction(this, "Function", {
      entry: path.join(props.handlersPath, "jiraNotifier.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      functionName,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      retryAttempts: 2,
      onFailure: new SqsDestination(deadLetterQueue),
      logGroup,
      role,
      environment: {
        stage: props.stage,
        servicePrefix: props.servicePrefix,
        jiraStageLabel: props.stageLabel,
        jiraSecretId: secretId,
      },
      vpc: ec2.Vpc.fromVpcAttributes(this, "Vpc", {
        vpcId: props.vpc.id,
        availabilityZones: ["us-east-1a", "us-east-1b", "us-east-1c"],
        privateSubnetIds: props.vpc.privateSubnets,
      }),
      securityGroups: [ec2.SecurityGroup.fromSecurityGroupId(this, "SecurityGroup", props.securityGroupId)],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    new events.Rule(this, "AlarmStateChangeRule", {
      description: `Opens or updates Jira tickets for ${props.servicePrefix} connection alarms`,
      eventPattern: {
        source: ["aws.cloudwatch"],
        detailType: ["CloudWatch Alarm State Change"],
        detail: {
          alarmName: events.Match.prefix(`${props.servicePrefix}-conn-`),
          state: { value: ["ALARM", "OK"] },
        },
      },
      targets: [new targets.LambdaFunction(this.function)],
    });

    new cloudwatch.CfnAlarm(this, "DeadLetterQueueAlarm", {
      alarmName: `${functionName}-dlq`,
      alarmDescription: "The Jira notifier could not open or update a ticket. Check the jiraNotifier logs.",
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensions: [{ name: "QueueName", value: deadLetterQueue.queueName }],
      statistic: "Maximum",
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      treatMissingData: "notBreaching",
      alarmActions: [props.alertsTopicArn],
    });
  }
}
```

- [ ] **Step 5: Wire it into the stack**

In `infra/lib/appian-connector-stack.ts`:

1. Add the import: `import { JiraNotifier } from "./jira-notifier";`
2. Directly before `const ecsFailureEventRule = new events.CfnRule(...)`, add:

```ts
    const jiraNotifier = fullConfig.jiraStageLabel
      ? new JiraNotifier(this, "JiraNotifier", {
          stage,
          servicePrefix,
          stageLabel: fullConfig.jiraStageLabel,
          alertsTopicArn,
          handlersPath,
          vpc,
          securityGroupId: lambdaConfigureConnectorsSecurityGroup.ref,
          logsKey: connectorLogsKey,
          iamPath,
          iamPermissionsBoundary,
        })
      : undefined;
```

3. In `ecsFailureEventRule`, after the existing SNS target object inside `targets: [ ... ]`, add:

```ts
        ...(jiraNotifier ? [{ arn: jiraNotifier.function.functionArn, id: "JiraNotifierEcsTaskFailure" }] : []),
```

4. Directly after the `ecsFailureEventRule` statement, add:

```ts
    if (jiraNotifier) {
      new lambda.CfnPermission(this, "JiraNotifierPermissionEcsFailureEventRule", {
        functionName: jiraNotifier.function.functionArn,
        action: "lambda:InvokeFunction",
        principal: "events.amazonaws.com",
        sourceArn: ecsFailureEventRule.attrArn,
      });
    }
```

- [ ] **Step 6: Run tests and the build**

Run: `yarn --cwd infra test && yarn --cwd infra build && yarn test-ci`
Expected: all PASS.

- [ ] **Step 7: Read-only diff against val**

Run: `cd infra && AWS_SDK_LOAD_CONFIG=1 STAGE_NAME=val AWS_PROFILE=bigmac-val npx cdk diff appian-connector-val`
Expected: adds the notifier function, role, policy, log group, SQS queue, event rule, Lambda permissions, and DLQ alarm. Adds the second target on `ECSFailureEventRule`. Alarm changes match Task 6. `TestConnectorsEventsRuleSchedule1` stays `DISABLED`. No ECS service or task definition replacement. If the CDK bootstrap or permissions boundary blocks the diff, stop and report.

- [ ] **Step 8: Stage (coordinator, after both reviews approve)**

```bash
git add infra/lib/jira-notifier.ts infra/lib/environment-config.ts infra/lib/appian-connector-stack.ts infra/test/
```

---

### Task 12: Docs for Part B

**Files:**
- Modify: `README.md`, `infra/README.md`, `src/services/alerts/README.md`, `AGENTS.md`, `docs/appian-connector-stability-spec.md`

- [ ] **Step 1: `README.md`**, add under `## Alerts`, after the alarm list:

````markdown
### Jira tickets (val and production)

In val and production, `appian-connector-<stage>-jiraNotifier` receives every `-conn-` alarm change and every Kafka Connect worker task stop. It opens one OY2 Bug per alarm (labels `macpro_appian_connector` plus `VAL` or `PROD`, epic OY2-29580, components BigMAC and MACPro Appian, assigned to PEIT). While that ticket is open, a repeat alarm or a recovery adds a comment. A person closes the ticket. Master does not open tickets.

The notifier reads secret `appian/<stage>/jira`, JSON with exactly these keys:

```json
{"url":"https://jiraent.cms.gov","token":"<personal access token>"}
```

To rotate the token, write that JSON to a file, run `aws secretsmanager put-secret-value --secret-id appian/<stage>/jira --secret-string file://<file>` with the stage's profile, and delete the file. If Jira cannot be reached, the event lands in `appian-connector-<stage>-jiraNotifier-dlq`, and its alarm emails the alerts topic.
````

- [ ] **Step 2: `infra/README.md`**, add under Lambda Functions:

```markdown
  - `jiraNotifier` (val and production): Opens or comments on OY2 Jira tickets for `-conn-` alarms and ECS task stops; failed events go to an SQS dead-letter queue
```

- [ ] **Step 3: `src/services/alerts/README.md`**, append to the paragraph that starts "Connector alarms, including the Oracle authentication alarm":

```markdown
In val and production, the connection alarms (`appian-connector-<stage>-conn-...`) and ECS task stops also open or update an OY2 Jira ticket through the connector stack's `jiraNotifier` Lambda. Email still comes from this topic.
```

- [ ] **Step 4: `AGENTS.md`**

Change the Lambda names bullet so it ends with: `` `appian-connector-master-testConnectors`, `appian-connector-val-jiraNotifier`, `appian-connector-production-jiraNotifier`. `` Then add:

```markdown
- In val and production, `appian-connector-{stage}-jiraNotifier` (reserved concurrency 1, two async retries, then SQS `appian-connector-{stage}-jiraNotifier-dlq` with an email alarm) receives `-conn-` alarm ALARM and OK events from EventBridge and ECS task-stopped events from `ECSFailureEventRule`. It finds the open ticket with `project = OY2 AND labels = macpro_appian_connector AND labels = {VAL|PROD} AND statusCategory != Done` plus an exact summary match. Then it creates the ticket, comments on a repeat, or comments on recovery and leaves the ticket open. Master has `jiraStageLabel: null` and no notifier. Fixed ticket values live in `src/services/connector/libs/jira-ticket-config.ts`.
```

- [ ] **Step 5: Spec status**

Set the status line to `**Status:** Implemented on master; deploy and rollout per [appian-connector-stability-plan.md](appian-connector-stability-plan.md) Tasks 13–18`.

- [ ] **Step 6: Final check and stage**

Run: `yarn test-tsc && yarn test-ci && yarn --cwd infra test`
Expected: all exit 0.

```bash
git add README.md infra/README.md src/services/alerts/README.md AGENTS.md docs/appian-connector-stability-spec.md
```

---

# Part C: single commit, CLI deploy to master, then push

Each AWS write and the push below need the user's go-ahead in the moment. An agent must stop and ask before running them.

### Task 13: Review gates and the single commit

- [ ] **Step 1: Stage everything and check for strays**

```bash
git add -A
git status --short
```

Expected: only files from the file map, this plan, the spec, and `AGENTS.md`. Nothing under `docs/daily summary/`, `cdk.out/`, `coverage/`, `node_modules/`, or any `.env` or secret file. Unstage anything else with `git restore --staged <path>`.

- [ ] **Step 2: Run the review gates** in "Review gates" above, in order, on the staged diff (`git diff --cached`). Loop fixes and re-run the gate that failed until every gate passes or the user waives a finding. After each fix, run `git add -A` again.

- [ ] **Step 3: Verify**

The CDK app reads Secrets Manager with aws-sdk v2, which only loads the `credential_process` profiles when `AWS_SDK_LOAD_CONFIG=1` is set. Every `cdk` command in this plan sets it.

```bash
cd "$(git rev-parse --show-toplevel)"
actionlint .github/workflows/unit-tests.yml .github/workflows/deploy.yml
pre-commit run --all-files
yarn install --frozen-lockfile
yarn test-tsc && yarn test-ci && yarn --cwd infra test
cd infra && yarn build
export AWS_SDK_LOAD_CONFIG=1
STAGE_NAME=master AWS_PROFILE=bigmac-dev npx cdk synth --quiet appian-alerts-master appian-connector-master \
  && ! rg -q jiraNotifier cdk.out/appian-connector-master.template.json && echo "master: no notifier"
STAGE_NAME=val AWS_PROFILE=bigmac-val npx cdk synth --quiet appian-alerts-val appian-connector-val \
  && rg -q jiraNotifier cdk.out/appian-connector-val.template.json && echo "val: notifier present"
STAGE_NAME=production AWS_PROFILE=bigmac-prod npx cdk synth --quiet appian-alerts-production appian-connector-production \
  && rg -q jiraNotifier cdk.out/appian-connector-production.template.json && echo "production: notifier present"
cd ..
if git diff --cached origin/master -- . ':(exclude)docs/**' ':(exclude)**/tests/**' ':(exclude)infra/test/**' \
  | rg '^\+' | rg -n -i 'Bearer [A-Za-z0-9]|"token"\s*:\s*"[^<]|password\s*[:=]\s*"[^$<]|jdbc:oracle:thin:@[0-9]'; then
  echo "possible secret; stop and review"
else
  echo "no secrets found"
fi
```

Expected: every command exits 0, the three synth lines print their stage messages, and the scan prints `no secrets found`. Synth only reads Secrets Manager; it writes nothing to AWS. The scan covers everything that will be pushed, including the two earlier docs commits, and it skips `docs/` and test folders, which hold placeholder values on purpose. Read the `docs/` part of `git diff --cached origin/master` by eye instead.

- [ ] **Step 4: Squash into one commit on top of `origin/master`**

```bash
git add -A
git diff --quiet && echo "nothing unstaged"
git fetch origin
git rev-list --count master..origin/master
```

Expected: `nothing unstaged`, then `0`. If the count is not `0`, `origin/master` moved: stop and ask the user before rebasing. Then:

```bash
git reset --soft origin/master
git commit -m "feat: connector health alarms, restart cap, and Jira tickets for connection problems" \
  -m "Implements docs/appian-connector-stability-spec.md Phases 1-3 per docs/appian-connector-stability-plan.md. Adds a unit-test workflow that gates deploy. Val and production health check schedules stay DISABLED."
git log --oneline origin/master..master
git status --short
```

Expected: exactly one commit, and a clean `git status`. The commit also replaces the two earlier unpushed docs commits.

### Task 14: Deploy master from the CLI

The deploy runs from the local commit with the `bigmac-dev` profile, exactly as `deploy.yml` does, but before anything is pushed. Val and production are not deployed from the CLI. They arrive through the release PRs in Part D.

- [ ] **Step 1: Check the profile and diff**

```bash
aws sts get-caller-identity --profile bigmac-dev --query Arn --output text
git status --short
cd "$(git rev-parse --show-toplevel)/infra" && yarn build
AWS_SDK_LOAD_CONFIG=1 STAGE_NAME=master AWS_PROFILE=bigmac-dev npx cdk diff appian-alerts-master appian-connector-master
```

Expected: the role is the bigmac developer admin role, and `git status` is clean, so the deploy matches the commit. The diff removes the three `Jdbc*Alarm` resources (`JdbcConnectorAlarm`, `JdbcTaskAlarm`, `JdbcOracleAuthAlarm`) and adds six `-conn-` alarms (four for `appian-connector-dbo-1`, `health-check-missing`, `health-check-errors`). It updates the `testConnectors` and `configureConnectors` code and adds the IAM statement for `cloudwatch:GetMetricStatistics`. It keeps the schedule rule `ENABLED`, and it adds no `jiraNotifier`. Show the diff to the user. Stop if it replaces (rather than updates) the ECS service, the task definition's network setup, or any security group.

- [ ] **Step 2: Deploy** (AWS write: ask first)

```bash
AWS_SDK_LOAD_CONFIG=1 STAGE_NAME=master AWS_PROFILE=bigmac-dev npx cdk deploy appian-alerts-master appian-connector-master --require-approval never
```

Expected: both stacks reach `UPDATE_COMPLETE` (or `no changes` for the alerts stack). On failure, read the stack events (`aws cloudformation describe-stack-events --profile bigmac-dev --stack-name appian-connector-master --max-items 20`), fix the cause with superpowers:systematic-debugging, amend the single commit (`git add -A && git commit --amend --no-edit`), re-run Task 13 Steps 2 and 3 on `git diff origin/master`, confirm `git log --oneline origin/master..master` still shows one commit, and deploy again. Do not push a commit that has not deployed cleanly.

### Task 15: Verify master, then push

- [ ] **Step 1:** Wait 10 minutes after the CLI deploy, then run:

```bash
aws cloudwatch describe-alarms --profile bigmac-dev --alarm-name-prefix appian-connector-master-conn- \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
```

Expected: 6 alarms (4 for the connector, `health-check-missing`, `health-check-errors`), all `OK`. Report any `ALARM` or `INSUFFICIENT_DATA`.

- [ ] **Step 2: Heartbeat drill** (AWS write: ask first)

```bash
RULE=$(aws events list-rules --profile bigmac-dev --name-prefix appian-connector-master-TestConnectors --query 'Rules[0].Name' --output text)
aws events disable-rule --profile bigmac-dev --name "$RULE"
```

Expected: within about 6 minutes, `appian-connector-master-conn-health-check-missing` goes to `ALARM` and an email arrives. Then:

```bash
aws events enable-rule --profile bigmac-dev --name "$RULE"
```

Expected: the alarm returns to `OK` within about 6 minutes, and a recovery email arrives.

- [ ] **Step 3: Push** (ask first). Only after Steps 1 and 2 pass:

```bash
git fetch origin
git rev-list --count master..origin/master
```

Expected: `0`. Otherwise stop and ask. Then:

```bash
git push origin master
SHA=$(git rev-parse HEAD)
until RUN=$(gh run list --branch master --workflow Deploy --commit "$SHA" --json databaseId --jq '.[0].databaseId // empty') && [ -n "$RUN" ]; do sleep 10; done
gh run watch "$RUN" --exit-status
gh pr list --base val --state open
```

Expected: the `Deploy` run for this commit passes its `unit-tests` job and then its `deploy` job, which finds no changes or only metadata changes because the CLI already deployed this commit. A release PR to `val` is open and its `Unit Tests / unit-tests` check passes. If a val release PR was already open (for example "Release to val" with earlier master commits), the push adds this commit to it, and merging it later also ships those earlier commits to val. Read its commit list before Task 16. Do not merge it yet.

---

# Part D: rollout to val and production

Each AWS write and each release PR merge below need the user's go-ahead in the moment. The production `Deploy` job runs in the `production` GitHub environment and waits for a required reviewer to approve it in GitHub Actions.

### Task 16: Verify the notifier in val

- [ ] **Step 1:** With the user's approval, merge the auto-created val release PR. Confirm the val deploy succeeded, and that `aws events list-rules --profile bigmac-val --name-prefix appian-connector-val-TestConnectors` still shows `DISABLED`.

- [ ] **Step 2: Fire a test alarm** (AWS write and Jira write: ask first)

```bash
aws cloudwatch set-alarm-state --profile bigmac-val \
  --alarm-name appian-connector-val-conn-appian-connector-dbo-1-connector-down \
  --state-value ALARM --state-reason "jiraNotifier test"
aws logs tail /aws/lambda/appian-connector-val-jiraNotifier --profile bigmac-val --since 5m
```

Expected: `JIRA_TICKET_CREATED key=OY2-...` in the log, an email on the alerts topic, and an OY2 Bug with summary `[VAL] Appian connector: appian-connector-dbo-1 connector is not RUNNING (...)`. It has labels `macpro_appian_connector` and `VAL`, Epic Link OY2-29580, components BigMAC and MACPro Appian, Working Team Platform Submission, and reporter and assignee PEIT.

If the log shows a 400 that names `customfield_10100`, Jira rejected the closed epic. Stop and ask whether to reopen OY2-29580 or use another epic.

- [ ] **Step 3: Recovery comment.** With no data, the alarm returns to `OK` on its next evaluation. If it does not within 2 minutes, run the same `set-alarm-state` with `--state-value OK --state-reason "jiraNotifier test recovery"`. Expected: `JIRA_TICKET_RECOVERED` in the log and a "Recovered at" comment on the ticket.

- [ ] **Step 4:** Confirm the DLQ is empty: `aws sqs get-queue-attributes --profile bigmac-val --queue-url $(aws sqs get-queue-url --profile bigmac-val --queue-name appian-connector-val-jiraNotifier-dlq --query QueueUrl --output text) --attribute-names ApproximateNumberOfMessages`. Then close the test ticket in Jira.

- [ ] **Step 5:** Merging to val opens a release PR to `production`. With the user's approval, merge it so the alarms and the notifier reach production while its schedule stays `DISABLED`. Confirm the production deploy succeeded and that `aws events list-rules --profile bigmac-prod --name-prefix appian-connector-production-TestConnectors` still shows `DISABLED`.

### Task 17: Enable the val health check

- [ ] **Step 1:** Ask the database team for the `FAILED_LOGIN_ATTEMPTS` limit on the val and production connector logins. Proceed only if it is above 3. With the cap, at most 3 one-attempt restarts happen per hour, and auth failures are never restarted.

- [ ] **Step 2:** On the local `master` (no branch), set `val.healthCheckSchedule` to `"ENABLED"` in `infra/lib/environment-config.ts`. Change the expectation in `infra/test/connector-alarms.test.ts` ("matches the live schedule state per stage") to `expect(environmentConfigs.val.healthCheckSchedule).toBe("ENABLED");`. In `AGENTS.md`, replace "Val and production stay `DISABLED` until Tasks 17 and 18" with "Val is `ENABLED`; production stays `DISABLED` until Task 18". Run `yarn --cwd infra test`, then `git add infra/lib/environment-config.ts infra/test/connector-alarms.test.ts AGENTS.md && git commit -m "chore: enable the val connector health check"`. With the user's approval, push `master` (the change does not affect master), then merge the val release PR. Leave the `production` release PR that follows open; Task 18 merges it with the production change.

- [ ] **Step 3:** Confirm the rule is `ENABLED` and, within 10 minutes, that all `appian-connector-val-conn-` alarms are `OK`:

```bash
aws cloudwatch describe-alarms --profile bigmac-val --alarm-name-prefix appian-connector-val-conn- \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output table
```

- [ ] **Step 4: Apply `connection.attempts` = 1** (AWS write: ask first). Do this only if the database team confirms the val `appian/val/dbInfo` password is current. Otherwise skip it: the restart cap still applies, and the setting takes effect at the next planned credential change.

```bash
aws lambda invoke --profile bigmac-val --function-name appian-connector-val-configureConnectors /tmp/configure-val.json
```

Expected: the status code is 200, and the output has no `FunctionError`. If the response contains `ORACLE_CONNECTOR_ERROR ... class=auth`, stop: do not invoke again, and contact the database team.

- [ ] **Step 5: Soak for 7 days.** Once a day, check for alarm transitions and restarts:

```bash
aws cloudwatch describe-alarm-history --profile bigmac-val --alarm-name appian-connector-val-conn-appian-connector-dbo-1-restart-capped --history-item-type StateUpdate --max-records 5
aws cloudwatch get-metric-statistics --profile bigmac-val --namespace appian-connector-val --metric-name source.jdbc.appian-connector-dbo-1_restarts \
  --start-time $(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ) --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) --period 86400 --statistics Sum
```

Expected: no lockouts, and few or no restarts. Any ticket that opens gets a person's review.

### Task 18: Enable the production health check

- [ ] **Step 1:** After a clean val soak, repeat Task 17 Steps 2–5 for production (still a single commit on the local `master`, then push, then merge the val and production release PRs in order): `production.healthCheckSchedule` = `"ENABLED"`, the test expectation, `AGENTS.md` (replace "Val is `ENABLED`; production stays `DISABLED` until Task 18" with "Val and production are `ENABLED`"), commit message `chore: enable the production connector health check`, profile `bigmac-prod`, prefix `appian-connector-production-conn-`, and `appian-connector-production-configureConnectors` only with the database team's confirmation.

- [ ] **Step 2:** Optionally fire one test alarm in production as in Task 16 to confirm a `[PROD]` ticket, then close it.

- [ ] **Step 3:** In the spec, set the status to `**Status:** Rolled out to master, val, and production.`, update `AGENTS.md` if anything changed, then `git add docs/appian-connector-stability-spec.md AGENTS.md && git commit -m "docs: mark connector stability rollout complete"` on the local `master`. Push it with the user's approval.
