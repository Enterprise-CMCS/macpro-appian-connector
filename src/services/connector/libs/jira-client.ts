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

const credentialsCache = new Map<string, Promise<JiraCredentials>>();

async function readCredentials(secretId: string): Promise<JiraCredentials> {
  const response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
  let parsed: Partial<JiraCredentials>;
  try {
    parsed = JSON.parse(response.SecretString ?? "{}") as Partial<JiraCredentials>;
  } catch {
    throw new Error(`Secret ${secretId} is not valid JSON`);
  }
  if (typeof parsed.url !== "string" || typeof parsed.token !== "string" || parsed.url === "" || parsed.token === "") {
    throw new Error(`Secret ${secretId} must be JSON with non-empty url and token`);
  }
  return { url: parsed.url.replace(/\/+$/, ""), token: parsed.token };
}

export function loadJiraCredentials(secretId: string): Promise<JiraCredentials> {
  let credentials = credentialsCache.get(secretId);
  if (!credentials) {
    credentials = readCredentials(secretId).catch((error: unknown) => {
      credentialsCache.delete(secretId);
      throw error;
    });
    credentialsCache.set(secretId, credentials);
  }
  return credentials;
}

export function clearJiraCredentialsCache(): void {
  credentialsCache.clear();
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
