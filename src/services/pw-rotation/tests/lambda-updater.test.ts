import { afterEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";

import {
  LambdaInvokeError,
  LambdaUpdateError,
  invokeConfigureConnectors,
  updateConfigureConnectorsEnv,
} from "../libs/lambda-updater";

const lambdaMock = mockClient(LambdaClient);

afterEach(() => {
  lambdaMock.reset();
  vi.restoreAllMocks();
});

const secret = {
  ip: "10.0.0.1",
  port: "1521",
  db: "APPIAN",
  user: "appuser",
  password: "REDACTED_NEW",
  schema: "DBO",
};

const noSleep = (_ms: number): Promise<void> => Promise.resolve();

describe("updateConfigureConnectorsEnv", () => {
  it("merges secret into existing env vars and waits for Successful", async () => {
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolvesOnce({
        Environment: { Variables: { unrelated: "keep", legacydbPassword: "OLD" } },
      })
      .resolvesOnce({ LastUpdateStatus: "InProgress" })
      .resolvesOnce({ LastUpdateStatus: "Successful" });
    lambdaMock.on(UpdateFunctionConfigurationCommand).resolves({});

    const result = await updateConfigureConnectorsEnv(
      new LambdaClient({}),
      "appian-connector-master-configureConnectors",
      secret,
      { sleep: noSleep, pollIntervalMs: 1, timeoutMs: 10_000 },
    );

    expect(result).toMatchObject({
      unrelated: "keep",
      legacydbPassword: "REDACTED_NEW",
      legacydbUser: "appuser",
      legacydbIp: "10.0.0.1",
      legacydbPort: "1521",
      legacyDb: "APPIAN",
      legacyschema: "DBO",
    });

    const updateCalls = lambdaMock.commandCalls(UpdateFunctionConfigurationCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input.Environment?.Variables?.legacydbPassword).toBe(
      "REDACTED_NEW",
    );
  });

  it("throws LambdaUpdateError when LastUpdateStatus becomes Failed", async () => {
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolvesOnce({ Environment: { Variables: {} } })
      .resolvesOnce({ LastUpdateStatus: "Failed", LastUpdateStatusReason: "role permission" });
    lambdaMock.on(UpdateFunctionConfigurationCommand).resolves({});

    await expect(
      updateConfigureConnectorsEnv(new LambdaClient({}), "fn", secret, {
        sleep: noSleep,
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      }),
    ).rejects.toBeInstanceOf(LambdaUpdateError);
  });

  it("throws LambdaUpdateError on timeout", async () => {
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolvesOnce({ Environment: { Variables: {} } })
      .resolves({ LastUpdateStatus: "InProgress" });
    lambdaMock.on(UpdateFunctionConfigurationCommand).resolves({});

    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const sleep = (ms: number): Promise<void> => {
      now += ms;
      return Promise.resolve();
    };

    await expect(
      updateConfigureConnectorsEnv(new LambdaClient({}), "fn", secret, {
        sleep,
        pollIntervalMs: 100,
        timeoutMs: 500,
      }),
    ).rejects.toThrow(/Timed out/);
  });
});

describe("invokeConfigureConnectors", () => {
  it("returns normally on a clean RequestResponse invocation", async () => {
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 200 });
    await invokeConfigureConnectors(new LambdaClient({}), "fn");
  });

  it("throws LambdaInvokeError when FunctionError is set", async () => {
    const payload = new TextEncoder().encode('{"errorMessage":"boom"}');
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: payload as unknown as never,
    });

    await expect(invokeConfigureConnectors(new LambdaClient({}), "fn")).rejects.toBeInstanceOf(
      LambdaInvokeError,
    );
  });

  it("throws LambdaInvokeError when StatusCode >= 300", async () => {
    lambdaMock.on(InvokeCommand).resolves({ StatusCode: 500 });
    await expect(invokeConfigureConnectors(new LambdaClient({}), "fn")).rejects.toThrow(
      /status code 500/,
    );
  });
});
