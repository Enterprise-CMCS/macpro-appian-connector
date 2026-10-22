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
