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
    expect(JSON.stringify(fields)).not.toContain("test-token");
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
