import { afterEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import {
  RecipientsConfigError,
  loadRecipients,
  parseRecipientsList,
} from "../libs/recipients";

const ssmMock = mockClient(SSMClient);

afterEach(() => ssmMock.reset());

describe("parseRecipientsList", () => {
  it("parses comma-separated emails", () => {
    expect(parseRecipientsList("alice@example.gov,bob@example.gov")).toEqual([
      "alice@example.gov",
      "bob@example.gov",
    ]);
  });

  it("supports semicolons and newlines as separators", () => {
    expect(parseRecipientsList("alice@example.gov; bob@example.gov\ncarol@example.gov")).toEqual([
      "alice@example.gov",
      "bob@example.gov",
      "carol@example.gov",
    ]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseRecipientsList("  alice@example.gov  ,  bob@example.gov  ")).toEqual([
      "alice@example.gov",
      "bob@example.gov",
    ]);
  });

  it("deduplicates repeated addresses", () => {
    expect(parseRecipientsList("alice@example.gov,alice@example.gov,bob@example.gov")).toEqual([
      "alice@example.gov",
      "bob@example.gov",
    ]);
  });

  it("rejects invalid email entries", () => {
    expect(() => parseRecipientsList("alice@example.gov,not-an-email")).toThrow(
      RecipientsConfigError,
    );
  });

  it("rejects an empty parsed list", () => {
    expect(() => parseRecipientsList(", , ;")).toThrow(/empty after parsing/);
  });
});

describe("loadRecipients", () => {
  it("reads the parameter and parses it", async () => {
    ssmMock.on(GetParameterCommand).resolves({
      Parameter: { Value: "alice@example.gov,bob@example.gov" },
    });
    const result = await loadRecipients(new SSMClient({}), "/path");
    expect(result).toEqual(["alice@example.gov", "bob@example.gov"]);
  });

  it("throws when parameter value is empty", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "" } });
    await expect(loadRecipients(new SSMClient({}), "/path")).rejects.toBeInstanceOf(
      RecipientsConfigError,
    );
  });

  it("throws when parameter is missing", async () => {
    ssmMock.on(GetParameterCommand).resolves({});
    await expect(loadRecipients(new SSMClient({}), "/path")).rejects.toThrow(/is empty/);
  });
});
