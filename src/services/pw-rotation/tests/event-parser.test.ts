import { describe, expect, it } from "vitest";
import {
  InvalidRotationEventError,
  parseRotationEvent,
} from "../libs/event-parser";

const EXPECTED = "appian/master/dbInfo";

function eventFrom(
  detail: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    source: "aws.secretsmanager",
    time: "2026-05-21T18:30:00Z",
    detail,
    ...overrides,
  };
}

describe("parseRotationEvent", () => {
  it("accepts PutSecretValue with matching secretId by name", () => {
    const result = parseRotationEvent(
      eventFrom({
        eventName: "PutSecretValue",
        eventSource: "secretsmanager.amazonaws.com",
        requestParameters: { secretId: EXPECTED },
      }),
      EXPECTED,
    );
    expect(result.secretIdentifier).toBe(EXPECTED);
    expect(result.eventName).toBe("PutSecretValue");
    expect(result.eventTime).toBe("2026-05-21T18:30:00Z");
  });

  it("accepts UpdateSecret with matching secretId by ARN", () => {
    const arn = `arn:aws:secretsmanager:us-east-1:123456789012:secret:${EXPECTED}-AbCdEf`;
    const result = parseRotationEvent(
      eventFrom({
        eventName: "UpdateSecret",
        eventSource: "secretsmanager.amazonaws.com",
        requestParameters: { secretId: arn },
      }),
      EXPECTED,
    );
    expect(result.secretIdentifier).toBe(arn);
  });

  it("accepts RotationSucceeded", () => {
    const result = parseRotationEvent(
      eventFrom({
        eventName: "RotationSucceeded",
        eventSource: "secretsmanager.amazonaws.com",
        requestParameters: { secretId: EXPECTED },
      }),
      EXPECTED,
    );
    expect(result.eventName).toBe("RotationSucceeded");
  });

  it("falls back to responseElements.arn when requestParameters.secretId is missing", () => {
    const arn = `arn:aws:secretsmanager:us-east-1:123456789012:secret:${EXPECTED}-AbCdEf`;
    const result = parseRotationEvent(
      eventFrom({
        eventName: "PutSecretValue",
        eventSource: "secretsmanager.amazonaws.com",
        responseElements: { arn },
      }),
      EXPECTED,
    );
    expect(result.secretIdentifier).toBe(arn);
  });

  it("throws when source is not aws.secretsmanager", () => {
    expect(() =>
      parseRotationEvent(
        { source: "aws.s3", detail: { eventName: "PutSecretValue" } },
        EXPECTED,
      ),
    ).toThrow(InvalidRotationEventError);
  });

  it("throws when detail is missing", () => {
    expect(() =>
      parseRotationEvent({ source: "aws.secretsmanager" }, EXPECTED),
    ).toThrow(/detail is missing/);
  });

  it("throws when eventName is not in the accepted set", () => {
    expect(() =>
      parseRotationEvent(
        eventFrom({
          eventName: "DeleteSecret",
          requestParameters: { secretId: EXPECTED },
        }),
        EXPECTED,
      ),
    ).toThrow(/Ignoring event: DeleteSecret/);
  });

  it("throws when the secret identifier cannot be extracted", () => {
    expect(() =>
      parseRotationEvent(
        eventFrom({ eventName: "PutSecretValue" }),
        EXPECTED,
      ),
    ).toThrow(/Could not extract secret identifier/);
  });

  it("throws when the secret does not match the expected one", () => {
    expect(() =>
      parseRotationEvent(
        eventFrom({
          eventName: "PutSecretValue",
          requestParameters: { secretId: "appian/val/dbInfo" },
        }),
        EXPECTED,
      ),
    ).toThrow(/does not match expected/);
  });

  it("throws for non-object input", () => {
    expect(() => parseRotationEvent("nope", EXPECTED)).toThrow(/not an object/);
    expect(() => parseRotationEvent(null, EXPECTED)).toThrow(/not an object/);
  });
});
