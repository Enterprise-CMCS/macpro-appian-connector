import {
  GetSecretValueCommand,
  type SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { DbInfoSecret } from "./types";

const REQUIRED_FIELDS: ReadonlyArray<keyof DbInfoSecret> = [
  "ip",
  "port",
  "db",
  "user",
  "password",
  "schema",
];

export class SecretReadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SecretReadError";
  }
}

export async function readDbInfoSecret(
  client: SecretsManagerClient,
  secretId: string,
): Promise<DbInfoSecret> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new SecretReadError(`Secret ${secretId} has no SecretString value`);
  }

  const parsed = parseJson(response.SecretString);
  return assertDbInfoShape(parsed, secretId);
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown JSON parse error";
    throw new SecretReadError(`Secret value is not valid JSON: ${message}`);
  }
}

function assertDbInfoShape(value: unknown, secretId: string): DbInfoSecret {
  if (typeof value !== "object" || value === null) {
    throw new SecretReadError(`Secret ${secretId} is not a JSON object`);
  }
  const record = value as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (typeof record[field] !== "string" || record[field] === "") {
      throw new SecretReadError(`Secret ${secretId} missing required field: ${field}`);
    }
  }
  return {
    ip: record.ip as string,
    port: record.port as string,
    db: record.db as string,
    user: record.user as string,
    password: record.password as string,
    schema: record.schema as string,
  };
}
