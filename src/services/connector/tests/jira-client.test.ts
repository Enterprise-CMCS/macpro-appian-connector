import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = mocks.send;
  },
  GetSecretValueCommand: class {
    constructor(public readonly input: Record<string, unknown>) {}
  },
}));

import { addComment, clearJiraCredentialsCache, createIssue, loadJiraCredentials, searchIssues } from "../libs/jira-client";

const credentials = { url: "https://jira.example.test", token: "test-token" };
const fetchMock = vi.fn();

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

describe("jira client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mocks.send.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    clearJiraCredentialsCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the secret once, trims a trailing slash, and caches it", async () => {
    mocks.send.mockResolvedValue({ SecretString: JSON.stringify({ url: "https://jira.example.test/", token: "test-token" }) });

    await expect(loadJiraCredentials("appian/val/jira")).resolves.toEqual(credentials);
    await loadJiraCredentials("appian/val/jira");

    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].input).toEqual({ SecretId: "appian/val/jira" });
  });

  it("rejects a secret without a token and does not cache the failure", async () => {
    mocks.send.mockResolvedValueOnce({ SecretString: JSON.stringify({ url: "https://jira.example.test" }) });
    await expect(loadJiraCredentials("appian/val/jira")).rejects.toThrow("must be JSON with non-empty url and token");

    mocks.send.mockResolvedValueOnce({ SecretString: JSON.stringify(credentials) });
    await expect(loadJiraCredentials("appian/val/jira")).resolves.toEqual(credentials);
  });

  it("rejects a non-JSON secret without including its text in the error", async () => {
    mocks.send.mockResolvedValue({ SecretString: "placeholder-secret-text-not-json" });

    const error = await loadJiraCredentials("appian/val/jira").catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Secret appian/val/jira is not valid JSON");
    expect((error as Error).message).not.toContain("placeholder-secret-text");
  });

  it("caches per secret id", async () => {
    mocks.send.mockImplementation(async (command: { input: { SecretId: string } }) => ({
      SecretString: JSON.stringify({ url: `https://${command.input.SecretId}.example.test`, token: `token-${command.input.SecretId}` }),
    }));

    await expect(loadJiraCredentials("a")).resolves.toEqual({ url: "https://a.example.test", token: "token-a" });
    await expect(loadJiraCredentials("b")).resolves.toEqual({ url: "https://b.example.test", token: "token-b" });
    await loadJiraCredentials("a");

    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("searches with the bearer token and the JQL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { issues: [{ key: "OY2-1", fields: { summary: "s" } }] }));

    await expect(searchIssues(credentials, "project = OY2")).resolves.toEqual([{ key: "OY2-1", summary: "s" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jira.example.test/rest/api/2/search?jql=project+%3D+OY2&fields=summary&maxResults=100");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer test-token");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("creates an issue and returns its key", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { key: "OY2-2" }));

    await expect(createIssue(credentials, { summary: "s" })).resolves.toBe("OY2-2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jira.example.test/rest/api/2/issue");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ fields: { summary: "s" } });
  });

  it("adds a comment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "1" }));

    await addComment(credentials, "OY2-2", "hello");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://jira.example.test/rest/api/2/issue/OY2-2/comment");
    expect(JSON.parse(init.body)).toEqual({ body: "hello" });
  });

  it("throws on a non-2xx response without exposing the token", async () => {
    fetchMock.mockResolvedValue(new Response('{"errors":{"customfield_10100":"bad epic"}}', { status: 400 }));

    const error = await createIssue(credentials, { summary: "s" }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("returned 400");
    expect((error as Error).message).toContain("bad epic");
    expect((error as Error).message).not.toContain("test-token");
  });
});
