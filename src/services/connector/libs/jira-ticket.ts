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
