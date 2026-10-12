import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorStatus } from "../../../types";

const mocks = vi.hoisted(() => ({
  testConnectors: vi.fn(),
  restartConnectors: vi.fn(),
  putConnectors: vi.fn(),
  deleteConnectors: vi.fn(),
  sendMetricData: vi.fn(),
}));

vi.mock("../../../libs/connect-lib", () => ({
  testConnectors: mocks.testConnectors,
  restartConnectors: mocks.restartConnectors,
  putConnectors: mocks.putConnectors,
  deleteConnectors: mocks.deleteConnectors,
}));

vi.mock("../../../libs/cloudwatch-lib", () => ({
  sendMetricData: mocks.sendMetricData,
}));

process.env.cluster = "cluster-1";
process.env.service = "service-1";
process.env.namespace = "appian-connector-master";
process.env.legacydbUser = "connector-user";
process.env.legacydbPassword = "secret-password-value";
process.env.legacydbIp = "10.1.2.3";
process.env.legacydbPort = "1521";
process.env.legacyDb = "APPDB";
process.env.topicNamespace = "";

const connectorName = "source.jdbc.appian-connector-dbo-1";
const jdbcUrl = "jdbc:oracle:thin:@10.1.2.3:1521:APPDB";

function status(state: string, trace?: string): ConnectorStatus {
  return {
    name: connectorName,
    connector: { state, worker_id: "worker-1" },
    tasks: [
      {
        id: 0,
        state,
        worker_id: "worker-1",
        trace,
      },
    ],
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

describe("testConnectors oracle health", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.sendMetricData.mockResolvedValue(undefined);
    mocks.restartConnectors.mockResolvedValue(undefined);
    mocks.testConnectors.mockReset();
  });

  it("treats ORA-01017 as an auth failure and does not restart", async () => {
    mocks.testConnectors.mockResolvedValue([
      status("FAILED", `java.sql.SQLException: ORA-01017: invalid username/password ${jdbcUrl}`),
    ]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(metricValue(`${connectorName}_oracle_auth_failures`)).toBe(1);
    expect(metricValue(`${connectorName}_oracle_errors`)).toBe(1);
    expect(metricValue(`${connectorName}_failures`)).toBe(1);
    expect(metricValue(`${connectorName}_task_failures`)).toBe(1);
    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(loggedText()).toContain(
      `ORACLE_CONNECTOR_ERROR connector=${connectorName} code=ORA-01017 class=auth`
    );
    expect(loggedText()).not.toContain(jdbcUrl);
    expect(loggedText()).not.toContain("secret-password-value");
  });

  it.each(["ORA-28000: the account is locked", "ERROR: Account Locked for this user"])(
    "treats %s as an auth failure and does not restart",
    async (trace) => {
      mocks.testConnectors.mockResolvedValue([status("FAILED", trace)]);
      const { handler } = await import("../handlers/testConnectors");

      await handler();

      expect(metricValue(`${connectorName}_oracle_auth_failures`)).toBe(1);
      expect(metricValue(`${connectorName}_oracle_errors`)).toBe(1);
      expect(mocks.restartConnectors).not.toHaveBeenCalled();
      expect(loggedText()).toMatch(
        new RegExp(`ORACLE_CONNECTOR_ERROR connector=${connectorName} code=(ORA-28000|account locked) class=auth`)
      );
    }
  );

  it("treats another ORA- code as an oracle error and restarts when the task is not running", async () => {
    mocks.testConnectors.mockResolvedValue([
      status("FAILED", "java.sql.SQLException: ORA-12541: TNS:no listener"),
    ]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(metricValue(`${connectorName}_oracle_auth_failures`)).toBe(0);
    expect(metricValue(`${connectorName}_oracle_errors`)).toBe(1);
    expect(mocks.restartConnectors).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain(
      `ORACLE_CONNECTOR_ERROR connector=${connectorName} code=ORA-12541 class=oracle`
    );
  });

  it("emits zeros and does not restart when the connector is running with no oracle trace", async () => {
    mocks.testConnectors.mockResolvedValue([status("RUNNING")]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(metricValue(`${connectorName}_oracle_auth_failures`)).toBe(0);
    expect(metricValue(`${connectorName}_oracle_errors`)).toBe(0);
    expect(metricValue(`${connectorName}_failures`)).toBe(0);
    expect(metricValue(`${connectorName}_task_failures`)).toBe(0);
    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain("ORACLE_CONNECTOR_ERROR");
  });

  it("matches oracle codes case-insensitively", async () => {
    mocks.testConnectors.mockResolvedValue([status("FAILED", "ora-01017: logon denied")]);
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(metricValue(`${connectorName}_oracle_auth_failures`)).toBe(1);
    expect(loggedText()).toContain("code=ORA-01017 class=auth");
    expect(mocks.restartConnectors).not.toHaveBeenCalled();
  });
});

describe("configureConnectors oracle health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.putConnectors.mockResolvedValue(undefined);
    mocks.deleteConnectors.mockResolvedValue(undefined);
    mocks.restartConnectors.mockResolvedValue(undefined);
    mocks.testConnectors.mockReset();
  });

  it("rejects an auth failure after put and does not restart", async () => {
    mocks.testConnectors.mockResolvedValue([
      status("FAILED", `ORA-01017: invalid username/password logon denied ${jdbcUrl}`),
    ]);
    const { handler } = await import("../handlers/configureConnectors");

    await expect(handler()).rejects.toThrow(
      `ORACLE_CONNECTOR_ERROR connector=${connectorName} code=ORA-01017 class=auth`
    );

    expect(mocks.putConnectors).toHaveBeenCalledTimes(1);
    expect(mocks.testConnectors).toHaveBeenCalledTimes(1);
    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain(jdbcUrl);
    expect(loggedText()).not.toContain("secret-password-value");
  });

  it("still restarts when the status after put is not an auth or lock failure", async () => {
    mocks.testConnectors.mockResolvedValue([status("RUNNING")]);
    const { handler } = await import("../handlers/configureConnectors");

    await handler();

    expect(mocks.testConnectors).toHaveBeenCalledTimes(1);
    expect(mocks.restartConnectors).toHaveBeenCalledTimes(1);
  });
});
