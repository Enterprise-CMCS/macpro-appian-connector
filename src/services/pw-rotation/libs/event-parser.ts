import type { ParsedRotationTrigger, SecretsManagerEvent } from "./types";

const ACCEPTED_EVENT_NAMES: ReadonlySet<string> = new Set([
  "PutSecretValue",
  "UpdateSecret",
  "RotationSucceeded",
]);

export class InvalidRotationEventError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidRotationEventError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export function parseRotationEvent(rawEvent: unknown, expectedSecretId: string): ParsedRotationTrigger {
  if (!isObject(rawEvent)) {
    throw new InvalidRotationEventError("Event is not an object");
  }

  const source = rawEvent.source;
  if (source !== "aws.secretsmanager") {
    throw new InvalidRotationEventError(`Unexpected event source: ${String(source)}`);
  }

  const detail = rawEvent.detail;
  if (!isObject(detail)) {
    throw new InvalidRotationEventError("Event detail is missing or invalid");
  }

  const event = rawEvent as unknown as SecretsManagerEvent;
  const eventName = event.detail.eventName;
  if (!eventName || !ACCEPTED_EVENT_NAMES.has(eventName)) {
    throw new InvalidRotationEventError(`Ignoring event: ${eventName ?? "<missing>"}`);
  }

  const secretId =
    event.detail.requestParameters?.secretId ??
    event.detail.responseElements?.arn ??
    event.detail.responseElements?.name;

  if (!secretId) {
    throw new InvalidRotationEventError("Could not extract secret identifier from event");
  }

  if (!matchesExpectedSecret(secretId, expectedSecretId)) {
    throw new InvalidRotationEventError(
      `Secret ${secretId} does not match expected ${expectedSecretId}`,
    );
  }

  return {
    secretIdentifier: secretId,
    eventName,
    eventTime: event.time ?? new Date().toISOString(),
  };
}

function matchesExpectedSecret(actual: string, expected: string): boolean {
  if (actual === expected) {
    return true;
  }
  if (actual.includes(":secret:")) {
    const namePart = actual.split(":secret:")[1] ?? "";
    const stripped = namePart.replace(/-[A-Za-z0-9]{6}$/, "");
    return stripped === expected || stripped.startsWith(`${expected}-`);
  }
  return false;
}
