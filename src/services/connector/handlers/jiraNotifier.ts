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
