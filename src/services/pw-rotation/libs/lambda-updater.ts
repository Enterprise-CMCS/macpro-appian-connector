import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  UpdateFunctionConfigurationCommand,
  type LambdaClient,
} from "@aws-sdk/client-lambda";
import type { DbInfoSecret } from "./types";

const ENV_KEYS_FROM_SECRET: ReadonlyArray<{ envKey: string; secretKey: keyof DbInfoSecret }> = [
  { envKey: "legacydbIp", secretKey: "ip" },
  { envKey: "legacydbPort", secretKey: "port" },
  { envKey: "legacyDb", secretKey: "db" },
  { envKey: "legacydbUser", secretKey: "user" },
  { envKey: "legacydbPassword", secretKey: "password" },
  { envKey: "legacyschema", secretKey: "schema" },
];

const POLL_INTERVAL_MS = 1_500;
const DEFAULT_UPDATE_TIMEOUT_MS = 60_000;
const SUCCESSFUL_STATUS = "Successful";
const FAILED_STATUS = "Failed";

export class LambdaUpdateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LambdaUpdateError";
  }
}

export class LambdaInvokeError extends Error {
  public constructor(
    message: string,
    public readonly payload?: string,
    public readonly functionError?: string,
  ) {
    super(message);
    this.name = "LambdaInvokeError";
  }
}

export interface UpdateOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function updateConfigureConnectorsEnv(
  client: LambdaClient,
  functionName: string,
  secret: DbInfoSecret,
  options: UpdateOptions = {},
): Promise<Record<string, string>> {
  const current = await client.send(
    new GetFunctionConfigurationCommand({ FunctionName: functionName }),
  );
  const existingEnv = current.Environment?.Variables ?? {};

  const nextEnv = mergeEnv(existingEnv, secret);

  await client.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: functionName,
      Environment: { Variables: nextEnv },
    }),
  );

  await waitForUpdateCompletion(client, functionName, options);
  return nextEnv;
}

function mergeEnv(existing: Record<string, string>, secret: DbInfoSecret): Record<string, string> {
  const next: Record<string, string> = { ...existing };
  for (const { envKey, secretKey } of ENV_KEYS_FROM_SECRET) {
    next[envKey] = secret[secretKey];
  }
  return next;
}

async function waitForUpdateCompletion(
  client: LambdaClient,
  functionName: string,
  options: UpdateOptions,
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeout = options.timeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const status = await client.send(
      new GetFunctionConfigurationCommand({ FunctionName: functionName }),
    );
    if (status.LastUpdateStatus === SUCCESSFUL_STATUS) {
      return;
    }
    if (status.LastUpdateStatus === FAILED_STATUS) {
      throw new LambdaUpdateError(
        `Lambda ${functionName} update failed: ${status.LastUpdateStatusReason ?? "unknown reason"}`,
      );
    }
    await sleep(interval);
  }

  throw new LambdaUpdateError(
    `Timed out waiting for Lambda ${functionName} update to complete after ${timeout}ms`,
  );
}

export async function invokeConfigureConnectors(
  client: LambdaClient,
  functionName: string,
): Promise<void> {
  const response = await client.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      LogType: "Tail",
    }),
  );

  const payload = response.Payload ? new TextDecoder().decode(response.Payload) : undefined;

  if (response.FunctionError) {
    throw new LambdaInvokeError(
      `configureConnectors invocation reported FunctionError=${response.FunctionError}`,
      payload,
      response.FunctionError,
    );
  }

  if (response.StatusCode !== undefined && response.StatusCode >= 300) {
    throw new LambdaInvokeError(
      `configureConnectors invocation returned status code ${response.StatusCode}`,
      payload,
    );
  }
}
