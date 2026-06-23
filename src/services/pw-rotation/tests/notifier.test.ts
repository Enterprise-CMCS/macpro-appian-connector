import { afterEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";

import {
  buildEmail,
  escapeHtml,
  sendRotationNotification,
} from "../libs/notifier";
import type { RotationContext, RotationResult } from "../libs/types";

const ses = mockClient(SESClient);

afterEach(() => ses.reset());

const ctx: RotationContext = {
  stage: "master",
  region: "us-east-1",
  trigger: {
    secretIdentifier: "appian/master/dbInfo",
    eventName: "PutSecretValue",
    eventTime: "2026-05-21T18:30:00Z",
  },
};

describe("buildEmail", () => {
  it("builds a success email with stage and event info", () => {
    const result: RotationResult = {
      kind: "success",
      verification: { status: "running" },
      context: ctx,
    };
    const email = buildEmail(result, "noreply@example.gov");
    expect(email.subject).toContain("master");
    expect(email.subject).toContain("succeeded");
    expect(email.text).toContain("PutSecretValue");
    expect(email.text).toContain("2026-05-21T18:30:00Z");
    expect(email.text).toContain("No action is required");
    expect(email.html).toContain("<strong>RUNNING</strong>");
  });

  it("builds a failure email with remediation steps numbered", () => {
    const result: RotationResult = {
      kind: "failure",
      phase: "verify_connector",
      error: "ORA-01017",
      remediation: {
        summary: "Bad password",
        steps: [
          { title: "Step one", detail: "Do thing A" },
          { title: "Step two", detail: "Do thing B" },
        ],
      },
      context: ctx,
    };
    const email = buildEmail(result, "noreply@example.gov");
    expect(email.subject).toContain("FAILED");
    expect(email.subject).toContain("verify_connector");
    expect(email.text).toContain("1. Step one");
    expect(email.text).toContain("2. Step two");
    expect(email.text).toContain("ORA-01017");
    expect(email.html).toContain("<ol>");
    expect(email.html).toContain("Step one");
  });

  it("escapes HTML in remediation content", () => {
    const result: RotationResult = {
      kind: "failure",
      phase: "verify_connector",
      error: '<script>alert("x")</script>',
      remediation: {
        summary: "Bad <input>",
        steps: [{ title: "T <one>", detail: 'D & "quoted"' }],
      },
      context: ctx,
    };
    const email = buildEmail(result, "noreply@example.gov");
    expect(email.html).not.toContain("<script>alert");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp;");
    expect(email.html).toContain("&quot;");
  });
});

describe("escapeHtml", () => {
  it("escapes the five canonical HTML chars", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });
});

describe("sendRotationNotification", () => {
  it("sends to all recipients via SES", async () => {
    ses.on(SendEmailCommand).resolves({ MessageId: "ses-msg-123" });
    const result: RotationResult = {
      kind: "success",
      verification: { status: "running" },
      context: ctx,
    };
    const messageId = await sendRotationNotification(
      new SESClient({}),
      {
        senderAddress: "noreply@example.gov",
        recipients: ["alice@example.gov", "bob@example.gov"],
      },
      result,
    );
    expect(messageId).toBe("ses-msg-123");
    const sentCalls = ses.commandCalls(SendEmailCommand);
    expect(sentCalls).toHaveLength(1);
    const input = sentCalls[0].args[0].input;
    expect(input.Source).toBe("noreply@example.gov");
    expect(input.Destination?.ToAddresses).toEqual(["alice@example.gov", "bob@example.gov"]);
    expect(input.Message?.Subject?.Data).toContain("succeeded");
  });

  it("propagates SES errors", async () => {
    ses.on(SendEmailCommand).rejects(new Error("MessageRejected"));
    const result: RotationResult = {
      kind: "success",
      verification: { status: "running" },
      context: ctx,
    };
    await expect(
      sendRotationNotification(
        new SESClient({}),
        { senderAddress: "noreply@example.gov", recipients: ["alice@example.gov"] },
        result,
      ),
    ).rejects.toThrow(/MessageRejected/);
  });
});
