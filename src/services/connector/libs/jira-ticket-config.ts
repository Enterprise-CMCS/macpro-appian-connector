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
