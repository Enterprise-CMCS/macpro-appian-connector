import { SendEmailCommand, type SESClient } from "@aws-sdk/client-ses";
import type { RotationContext, RotationResult } from "./types";

export interface NotifierConfig {
  senderAddress: string;
  recipients: ReadonlyArray<string>;
}

export async function sendRotationNotification(
  client: SESClient,
  config: NotifierConfig,
  result: RotationResult,
): Promise<string | undefined> {
  const message = buildEmail(result, config.senderAddress);
  const response = await client.send(
    new SendEmailCommand({
      Source: config.senderAddress,
      Destination: { ToAddresses: [...config.recipients] },
      Message: {
        Subject: { Data: message.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: message.text, Charset: "UTF-8" },
          Html: { Data: message.html, Charset: "UTF-8" },
        },
      },
    }),
  );
  return response.MessageId;
}

interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function buildEmail(result: RotationResult, sender: string): EmailContent {
  if (result.kind === "success") {
    return successEmail(result.context, sender);
  }
  return failureEmail(result, sender);
}

function successEmail(context: RotationContext, sender: string): EmailContent {
  const subject = `[appian-connector:${context.stage}] DB password rotation succeeded`;
  const header = `The Appian connector DB password was rotated successfully in stage "${context.stage}".`;
  const eventLine = `Triggering event: ${context.trigger.eventName} on secret ${context.trigger.secretIdentifier} at ${context.trigger.eventTime}.`;
  const text = [
    header,
    "",
    eventLine,
    "",
    "The Kafka Connect JDBC source connector is RUNNING with healthy tasks.",
    "",
    "No action is required.",
    "",
    `Sent by ${sender}`,
  ].join("\n");
  const html = wrapHtml(
    "DB password rotation succeeded",
    [
      `<p>${escapeHtml(header)}</p>`,
      `<p>${escapeHtml(eventLine)}</p>`,
      "<p>The Kafka Connect JDBC source connector is <strong>RUNNING</strong> with healthy tasks.</p>",
      "<p>No action is required.</p>",
    ].join("\n"),
  );
  return { subject, text, html };
}

function failureEmail(
  result: Extract<RotationResult, { kind: "failure" }>,
  sender: string,
): EmailContent {
  const { context, phase, error, remediation } = result;
  const subject = `[appian-connector:${context.stage}] DB password rotation FAILED (${phase})`;
  const header = `Automated DB password rotation in stage "${context.stage}" FAILED during phase: ${phase}.`;
  const eventLine = `Triggering event: ${context.trigger.eventName} on secret ${context.trigger.secretIdentifier} at ${context.trigger.eventTime}.`;
  const errorLine = `Error: ${error}`;
  const summary = `Diagnosis: ${remediation.summary}`;
  const stepLinesText = remediation.steps.map(
    (s, i) => `  ${i + 1}. ${s.title}\n     ${s.detail}`,
  );
  const text = [
    header,
    "",
    eventLine,
    errorLine,
    "",
    summary,
    "",
    "Suggested remediation steps:",
    ...stepLinesText,
    "",
    `Sent by ${sender}`,
  ].join("\n");

  const stepLinesHtml = remediation.steps
    .map(
      (s) =>
        `<li><strong>${escapeHtml(s.title)}</strong><br/>${escapeHtml(s.detail).replace(/\n/g, "<br/>")}</li>`,
    )
    .join("\n");

  const html = wrapHtml(
    "DB password rotation FAILED",
    [
      `<p><strong>${escapeHtml(header)}</strong></p>`,
      `<p>${escapeHtml(eventLine)}</p>`,
      `<p><code>${escapeHtml(errorLine)}</code></p>`,
      `<p>${escapeHtml(summary)}</p>`,
      "<p><strong>Suggested remediation steps:</strong></p>",
      `<ol>${stepLinesHtml}</ol>`,
    ].join("\n"),
  );
  return { subject, text, html };
}

function wrapHtml(title: string, inner: string): string {
  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\"/></head><body>",
    `<h2>${escapeHtml(title)}</h2>`,
    inner,
    "</body></html>",
  ].join("\n");
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
