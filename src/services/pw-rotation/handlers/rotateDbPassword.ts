import { LambdaClient } from "@aws-sdk/client-lambda";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SESClient } from "@aws-sdk/client-ses";
import { SSMClient } from "@aws-sdk/client-ssm";
import { ECSClient } from "@aws-sdk/client-ecs";

import { parseRotationEvent, InvalidRotationEventError } from "../libs/event-parser";
import { readDbInfoSecret } from "../libs/secrets";
import { invokeConfigureConnectors, updateConfigureConnectorsEnv } from "../libs/lambda-updater";
import { findKafkaConnectWorkerIp } from "../libs/ecs-discovery";
import { verifyConnectorRunning as defaultVerifyConnectorRunning } from "../libs/connector-verifier";
import { loadRecipients } from "../libs/recipients";
import { buildRemediationPlan } from "../libs/remediation";
import { sendRotationNotification } from "../libs/notifier";
import type { ParsedRotationTrigger, RotationContext, RotationPhase, RotationResult, VerificationOutcome } from "../libs/types";

export interface RotationClients {
  secrets: SecretsManagerClient;
  lambda: LambdaClient;
  ssm: SSMClient;
  ses: SESClient;
  ecs: ECSClient;
}

export interface RotationOverrides {
  verifyConnectorRunning?: (workerIp: string, connectorName: string) => Promise<VerificationOutcome>;
}

export interface RotationConfig {
  stage: string;
  region: string;
  dbSecretId: string;
  configureConnectorsFunctionName: string;
  cluster: string;
  service: string;
  connectorName: string;
  recipientsParameterName: string;
  notificationSender: string;
}

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

export const handler = async (event: unknown): Promise<RotationResult> => {
  const config = readConfig();
  const clients = createClients(config.region);
  return runRotation(event, config, clients);
};

export async function runRotation(
  event: unknown,
  config: RotationConfig,
  clients: RotationClients,
  overrides: RotationOverrides = {}
): Promise<RotationResult> {
  const verifyConnectorRunning = overrides.verifyConnectorRunning ?? defaultVerifyConnectorRunning;
  console.log("pw-rotation invoked");

  let trigger: ParsedRotationTrigger;
  try {
    trigger = parseRotationEvent(event, config.dbSecretId);
  } catch (error: unknown) {
    if (error instanceof InvalidRotationEventError) {
      console.log(`Skipping event: ${error.message}`);
      throw error;
    }
    return failBeforeContext(config, "parse_event", errorMessage(error));
  }

  const context: RotationContext = {
    stage: config.stage,
    region: config.region,
    trigger,
  };

  const failureResult = (phase: RotationPhase, error: unknown, verification?: VerificationOutcome): RotationResult => {
    const message = errorMessage(error);
    const remediation = buildRemediationPlan({
      phase,
      errorMessage: message,
      verification,
    });
    return {
      kind: "failure",
      phase,
      error: message,
      verification,
      remediation,
      context,
    };
  };

  let secret;
  try {
    secret = await readDbInfoSecret(clients.secrets, trigger.secretIdentifier);
  } catch (error: unknown) {
    return finalize(clients, config, failureResult("read_secret", error));
  }

  try {
    await updateConfigureConnectorsEnv(clients.lambda, config.configureConnectorsFunctionName, secret);
  } catch (error: unknown) {
    return finalize(clients, config, failureResult("update_lambda_env", error));
  }

  try {
    await invokeConfigureConnectors(clients.lambda, config.configureConnectorsFunctionName);
  } catch (error: unknown) {
    return finalize(clients, config, failureResult("invoke_configure_connectors", error));
  }

  let verification: VerificationOutcome;
  try {
    const workerIp = await findKafkaConnectWorkerIp(clients.ecs, config.cluster, config.service);
    verification = await verifyConnectorRunning(workerIp, config.connectorName);
  } catch (error: unknown) {
    return finalize(clients, config, failureResult("verify_connector", error));
  }

  if (verification.status !== "running") {
    return finalize(
      clients,
      config,
      failureResult("verify_connector", new Error(`Connector did not reach RUNNING (status=${verification.status})`), verification)
    );
  }

  return finalize(clients, config, {
    kind: "success",
    verification,
    context,
  });
}

async function finalize(clients: RotationClients, config: RotationConfig, result: RotationResult): Promise<RotationResult> {
  try {
    const recipients = await loadRecipients(clients.ssm, config.recipientsParameterName);
    await sendRotationNotification(clients.ses, { senderAddress: config.notificationSender, recipients }, result);
  } catch (error: unknown) {
    console.error(`Failed to send rotation notification: ${errorMessage(error)}. Result kind=${result.kind}.`);
  }
  return result;
}

function failBeforeContext(config: RotationConfig, phase: RotationPhase, error: string): RotationResult {
  const context: RotationContext = {
    stage: config.stage,
    region: config.region,
    trigger: {
      secretIdentifier: config.dbSecretId,
      eventName: "parse-failed",
      eventTime: new Date().toISOString(),
    },
  };
  return {
    kind: "failure",
    phase,
    error,
    remediation: buildRemediationPlan({ phase, errorMessage: error }),
    context,
  };
}

function readConfig(): RotationConfig {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value || value.trim() === "") {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  return {
    stage: required("STAGE"),
    region: process.env.AWS_REGION ?? "us-east-1",
    dbSecretId: required("DB_SECRET_ID"),
    configureConnectorsFunctionName: required("CONFIGURE_CONNECTORS_FUNCTION"),
    cluster: required("CLUSTER"),
    service: required("SERVICE"),
    connectorName: required("CONNECTOR_NAME"),
    recipientsParameterName: required("RECIPIENTS_SSM_PARAMETER"),
    notificationSender: required("NOTIFICATION_SENDER"),
  };
}

function createClients(region: string): RotationClients {
  return {
    secrets: new SecretsManagerClient({ region }),
    lambda: new LambdaClient({ region }),
    ssm: new SSMClient({ region }),
    ses: new SESClient({ region }),
    ecs: new ECSClient({ region }),
  };
}
