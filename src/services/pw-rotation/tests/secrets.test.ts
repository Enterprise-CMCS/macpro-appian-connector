import { afterEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { readDbInfoSecret, SecretReadError } from "../libs/secrets";

const sm = mockClient(SecretsManagerClient);

afterEach(() => sm.reset());

const validSecret = {
  ip: "10.0.0.1",
  port: "1521",
  db: "APPIAN",
  user: "appuser",
  password: "REDACTED_NEW",
  schema: "DBO",
};

describe("readDbInfoSecret", () => {
  it("returns parsed secret when SecretString is valid", async () => {
    sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(validSecret) });
    const result = await readDbInfoSecret(new SecretsManagerClient({}), "appian/master/dbInfo");
    expect(result).toEqual(validSecret);
  });

  it("throws when SecretString is missing", async () => {
    sm.on(GetSecretValueCommand).resolves({});
    await expect(
      readDbInfoSecret(new SecretsManagerClient({}), "appian/master/dbInfo"),
    ).rejects.toBeInstanceOf(SecretReadError);
  });

  it("throws when SecretString is not JSON", async () => {
    sm.on(GetSecretValueCommand).resolves({ SecretString: "not json" });
    await expect(
      readDbInfoSecret(new SecretsManagerClient({}), "appian/master/dbInfo"),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("throws when a required field is missing", async () => {
    const { password: _password, ...partial } = validSecret;
    sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(partial) });
    await expect(
      readDbInfoSecret(new SecretsManagerClient({}), "appian/master/dbInfo"),
    ).rejects.toThrow(/missing required field: password/);
  });

  it("throws when a required field is empty string", async () => {
    const empty = { ...validSecret, user: "" };
    sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(empty) });
    await expect(
      readDbInfoSecret(new SecretsManagerClient({}), "appian/master/dbInfo"),
    ).rejects.toThrow(/missing required field: user/);
  });

  it("throws when SecretString is JSON but not an object", async () => {
    sm.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify(["array"]) });
    await expect(
      readDbInfoSecret(new SecretsManagerClient({}), "appian/master/dbInfo"),
    ).rejects.toThrow(/missing required field/);
  });

  it("propagates AWS errors", async () => {
    sm.on(GetSecretValueCommand).rejects(new Error("AccessDeniedException"));
    await expect(
      readDbInfoSecret(new SecretsManagerClient({}), "appian/master/dbInfo"),
    ).rejects.toThrow(/AccessDeniedException/);
  });
});
