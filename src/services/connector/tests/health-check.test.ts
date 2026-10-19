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

  it("does not restart when the restart count cannot be recorded", async () => {
    mocks.testConnectors.mockResolvedValue([status("FAILED")]);
    mocks.sendMetricData.mockImplementation(async (params: { MetricData: Array<{ MetricName: string }> }) => {
      const metricName = params.MetricData[0]?.MetricName ?? "";
      return !metricName.endsWith("_restarts");
    });
    const { handler } = await import("../handlers/testConnectors");

    await handler();

    expect(mocks.restartConnectors).not.toHaveBeenCalled();
    expect(loggedText()).toContain(`Could not record restart for ${connectorName}`);
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
