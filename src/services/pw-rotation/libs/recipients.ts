import { GetParameterCommand, type SSMClient } from "@aws-sdk/client-ssm";

export class RecipientsConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RecipientsConfigError";
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loadRecipients(
  client: SSMClient,
  parameterName: string,
): Promise<ReadonlyArray<string>> {
  const response = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: false }),
  );
  const raw = response.Parameter?.Value;
  if (!raw || raw.trim() === "") {
    throw new RecipientsConfigError(
      `SSM parameter ${parameterName} is empty; configure at least one recipient email.`,
    );
  }
  return parseRecipientsList(raw);
}

export function parseRecipientsList(raw: string): ReadonlyArray<string> {
  const candidates = raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (candidates.length === 0) {
    throw new RecipientsConfigError("Recipients list is empty after parsing.");
  }

  const invalid = candidates.filter((s) => !EMAIL_REGEX.test(s));
  if (invalid.length > 0) {
    throw new RecipientsConfigError(
      `Invalid email address(es) in recipients list: ${invalid.join(", ")}`,
    );
  }

  return Array.from(new Set(candidates));
}
