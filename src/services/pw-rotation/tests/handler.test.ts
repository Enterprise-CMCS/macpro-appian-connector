import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  GetFunctionConfigurationCommand,
  InvokeCommand,
  LambdaClient,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import {
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";

import { handler, runRotation } from "../handlers/rotateDbPassword";
import { InvalidRotationEventError } from "../libs/event-parser";

const sm = mockClient(SecretsManagerClient);
const lambdaMock = mockClient(LambdaClient);
const ssm = mockClient(SSMClient);
const ses = mockClient(SESClient);
const ecs = mockClient(ECSClient);

beforeEach(() => {
  sm.reset();
  lambdaMock.reset();
  ssm.reset();
  ses.reset();
  ecs.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const verifyRunning = async () => ({ status: "running" as const });

const verifyFailingWithTrace = (trace: string) => async () => ({
  status: "failed" as const,
  connectorState: "RUNNING",
  taskStates: ["FAILED"],
  traceSnippet: trace,
});

const baseConfig = {
  stage: "master",
  region: "us-east-1",
  dbSecretId: "appian/master/dbInfo",
  configureConnectorsFunctionName: "appian-connector-master-configureConnectors",
  cluster: "appian-connector-master-connect",
  service: "kafka-connect",
  connectorName: "source.jdbc.appian-connector-dbo-1",
  recipientsParameterName: "/appian/master/pw-rotation/recipients",
  notificationSender: "noreply@example.gov",
};

const validSecretJson = JSON.stringify({
  ip: "10.0.0.1",
  port: "1521",
  db: "APPIAN",
  user: "appuser",
  password: "REDACTED_NEW",
  schema: "DBO",
});

const validEvent = {
  source: "aws.secretsmanager",
  time: "2026-05-21T18:30:00Z",
  detail: {
    eventName: "PutSecretValue",
    eventSource: "secretsmanager.amazonaws.com",
    requestParameters: { secretId: "appian/master/dbInfo" },
  },
};

const happyPathSetup = (): void => {
  sm.on(GetSecretValueCommand).resolves({ SecretString: validSecretJson });
  lambdaMock
    .on(GetFunctionConfigurationCommand)
    .resolvesOnce({ Environment: { Variables: {} } })
    .resolves({ LastUpdateStatus: "Successful" });
  lambdaMock.on(UpdateFunctionConfigurationCommand).resolves({});
  lambdaMock.on(InvokeCommand).resolves({ StatusCode: 200 });
  ecs.on(ListTasksCommand).resolves({ taskArns: ["arn:task:1"] });
  ecs.on(DescribeTasksCommand).resolves({
    tasks: [
      {
        attachments: [
          { details: [{ name: "privateIPv4Address", value: "10.0.0.7" }] },
        ],
      },
    ],
  });
  ssm.on(GetParameterCommand).resolves({
    Parameter: { Value: "alice@example.gov,bob@example.gov" },
  });
  ses.on(SendEmailCommand).resolves({ MessageId: "ses-1" });
};

const clients = () => ({
  secrets: new SecretsManagerClient({}),
  lambda: new LambdaClient({}),
  ssm: new SSMClient({}),
  ses: new SESClient({}),
  ecs: new ECSClient({}),
});

describe("handler (bootstrap)", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws when required env vars are missing", async () => {
    delete process.env.STAGE;
    delete process.env.DB_SECRET_ID;
    delete process.env.CONFIGURE_CONNECTORS_FUNCTION;
    delete process.env.CLUSTER;
    delete process.env.SERVICE;
    delete process.env.CONNECTOR_NAME;
    delete process.env.RECIPIENTS_SSM_PARAMETER;
    delete process.env.NOTIFICATION_SENDER;

    await expect(handler(validEvent)).rejects.toThrow(/Missing required environment variable/);
  });

  it("constructs config and clients from env when handler runs end-to-end (mismatched secret short-circuits)", async () => {
    process.env.STAGE = "master";
    process.env.DB_SECRET_ID = "appian/master/dbInfo";
    process.env.CONFIGURE_CONNECTORS_FUNCTION = "appian-connector-master-configureConnectors";
    process.env.CLUSTER = "appian-connector-master-connect";
    process.env.SERVICE = "kafka-connect";
    process.env.CONNECTOR_NAME = "source.jdbc.appian-connector-dbo-1";
    process.env.RECIPIENTS_SSM_PARAMETER = "/appian/master/pw-rotation/recipients";
    process.env.NOTIFICATION_SENDER = "noreply@example.gov";

    const mismatched = {
      ...validEvent,
      detail: { ...validEvent.detail, requestParameters: { secretId: "appian/val/dbInfo" } },
    };

    await expect(handler(mismatched)).rejects.toBeInstanceOf(InvalidRotationEventError);
  });
});

describe("runRotation - happy path", () => {
  it("returns success and sends a success email", async () => {
    happyPathSetup();
    const result = await runRotation(validEvent, baseConfig, clients(), {
      verifyConnectorRunning: verifyRunning,
    });
    expect(result.kind).toBe("success");

    const sesCalls = ses.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);
    expect(sesCalls[0].args[0].input.Message?.Subject?.Data).toContain("succeeded");
  });
});

describe("runRotation - failure paths", () => {
  it("throws InvalidRotationEventError when event is for a different secret", async () => {
    const mismatchedEvent = {
      ...validEvent,
      detail: {
        ...validEvent.detail,
        requestParameters: { secretId: "appian/val/dbInfo" },
      },
    };
    await expect(runRotation(mismatchedEvent, baseConfig, clients())).rejects.toBeInstanceOf(
      InvalidRotationEventError,
    );
  });

  it("reports read_secret failure and still emails", async () => {
    sm.on(GetSecretValueCommand).rejects(new Error("AccessDeniedException"));
    ssm.on(GetParameterCommand).resolves({
      Parameter: { Value: "ops@example.gov" },
    });
    ses.on(SendEmailCommand).resolves({ MessageId: "ses-2" });

    const result = await runRotation(validEvent, baseConfig, clients());
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.phase).toBe("read_secret");
      expect(result.remediation.summary).toMatch(/could not read/i);
    }
    expect(ses.commandCalls(SendEmailCommand)).toHaveLength(1);
  });

  it("reports update_lambda_env failure when Lambda update fails", async () => {
    sm.on(GetSecretValueCommand).resolves({ SecretString: validSecretJson });
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolvesOnce({ Environment: { Variables: {} } })
      .resolves({ LastUpdateStatus: "Failed", LastUpdateStatusReason: "role error" });
    lambdaMock.on(UpdateFunctionConfigurationCommand).resolves({});
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "ops@example.gov" } });
    ses.on(SendEmailCommand).resolves({ MessageId: "ses-3" });

    const result = await runRotation(validEvent, baseConfig, clients());
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.phase).toBe("update_lambda_env");
    }
  });

  it("reports invoke_configure_connectors failure when invocation has FunctionError", async () => {
    sm.on(GetSecretValueCommand).resolves({ SecretString: validSecretJson });
    lambdaMock
      .on(GetFunctionConfigurationCommand)
      .resolvesOnce({ Environment: { Variables: {} } })
      .resolves({ LastUpdateStatus: "Successful" });
    lambdaMock.on(UpdateFunctionConfigurationCommand).resolves({});
    lambdaMock.on(InvokeCommand).resolves({
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: new TextEncoder().encode('{"errorMessage":"boom"}') as unknown as never,
    });
    ssm.on(GetParameterCommand).resolves({ Parameter: { Value: "ops@example.gov" } });
    ses.on(SendEmailCommand).resolves({ MessageId: "ses-4" });

    const result = await runRotation(validEvent, baseConfig, clients());
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.phase).toBe("invoke_configure_connectors");
    }
  });

  it("reports verify_connector failure with ORA-01017 remediation when task fails", async () => {
    happyPathSetup();
    const trace =
      "Caused by: java.sql.SQLException: ORA-01017: invalid username/password; logon denied";
    const result = await runRotation(validEvent, baseConfig, clients(), {
      verifyConnectorRunning: verifyFailingWithTrace(trace),
    });
    expect(result.kind).toBe("failure");
    if (result.kind === "failure") {
      expect(result.phase).toBe("verify_connector");
      expect(result.remediation.steps.some((s) => /ORA-01017/.test(s.title))).toBe(true);
    }
  });

  it("does not throw when notification (final SES call) fails; returns rotation result anyway", async () => {
    happyPathSetup();
    ses.reset();
    ses.on(SendEmailCommand).rejects(new Error("MessageRejected"));

    const result = await runRotation(validEvent, baseConfig, clients(), {
      verifyConnectorRunning: verifyRunning,
    });
    expect(result.kind).toBe("success");
  });
});
