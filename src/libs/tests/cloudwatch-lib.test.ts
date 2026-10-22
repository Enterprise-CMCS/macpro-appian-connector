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

import { getMetricSum, sendMetricData } from "../cloudwatch-lib";

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

describe("sendMetricData", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("returns false when CloudWatch rejects the publish", async () => {
    mocks.send.mockRejectedValue(new Error("Throttling"));
    await expect(sendMetricData({ Namespace: "ns", MetricData: [{ MetricName: "m", Value: 1 }] })).resolves.toBe(false);
  });

  it("returns true when CloudWatch accepts the publish", async () => {
    mocks.send.mockResolvedValue({});
    await expect(sendMetricData({ Namespace: "ns", MetricData: [{ MetricName: "m", Value: 1 }] })).resolves.toBe(true);
  });
});
