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
