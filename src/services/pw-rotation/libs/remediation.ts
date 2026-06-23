import type {
  RemediationPlan,
  RemediationStep,
  RotationPhase,
  VerificationOutcome,
} from "./types";

interface FailureInput {
  phase: RotationPhase;
  errorMessage: string;
  verification?: VerificationOutcome;
}

const SECRET_READ_STEPS: ReadonlyArray<RemediationStep> = [
  {
    title: "Confirm the secret value was saved",
    detail:
      "Open Secrets Manager in the AWS console and re-open the dbInfo secret. Make sure the new JSON value is valid and includes all six fields: ip, port, db, user, password, schema.",
  },
  {
    title: "Check IAM permissions on the rotation Lambda",
    detail:
      "The rotation Lambda role must have secretsmanager:GetSecretValue against the dbInfo secret ARN. If you recently restricted KMS permissions, the secret may now be unreadable.",
  },
];

const LAMBDA_UPDATE_STEPS: ReadonlyArray<RemediationStep> = [
  {
    title: "Re-run the rotation",
    detail:
      "AWS Lambda will sometimes return UpdateInProgress when concurrent updates collide. Wait one minute, then re-save the secret value to retrigger rotation.",
  },
  {
    title: "Inspect the configureConnectors function",
    detail:
      "Open the configureConnectors Lambda in the AWS console and confirm LastUpdateStatus. If it is Failed, the StatusReason will explain (e.g., role missing permission, env exceeds 4 KB limit).",
  },
];

const INVOKE_STEPS: ReadonlyArray<RemediationStep> = [
  {
    title: "Tail configureConnectors logs",
    detail:
      "Open /aws/lambda/appian-connector-{stage}-configureConnectors. The most recent invocation log group will show why it failed (most often: cannot reach the Kafka Connect REST endpoint inside the VPC).",
  },
  {
    title: "Verify Kafka Connect ECS service is healthy",
    detail:
      "Confirm the kafka-connect ECS service in the appian-connector-{stage}-connect cluster has at least one task in RUNNING state. If not, restart the service.",
  },
];

export function buildRemediationPlan(input: FailureInput): RemediationPlan {
  switch (input.phase) {
    case "parse_event":
      return {
        summary:
          "The rotation Lambda received an event it could not parse. This usually means the EventBridge rule pattern is wider than expected.",
        steps: [
          {
            title: "Inspect the failing event payload",
            detail:
              "Check CloudWatch Logs for the rotation Lambda; the full event body is logged. If it is not a Secrets Manager PutSecretValue/UpdateSecret event, tighten the EventBridge rule filter.",
          },
        ],
      };

    case "read_secret":
      return {
        summary:
          "The rotation Lambda could not read the new dbInfo secret from Secrets Manager.",
        steps: SECRET_READ_STEPS,
      };

    case "update_lambda_env":
      return {
        summary:
          "The rotation Lambda failed to push the new password into the configureConnectors Lambda environment.",
        steps: LAMBDA_UPDATE_STEPS,
      };

    case "invoke_configure_connectors":
      return {
        summary:
          "The configureConnectors Lambda invocation failed after the password was updated. The new password is in place but Kafka Connect was not refreshed.",
        steps: INVOKE_STEPS,
      };

    case "verify_connector":
      return buildVerificationRemediation(input.verification, input.errorMessage);

    case "notify":
      return {
        summary:
          "The rotation succeeded but the notification step itself failed. This is informational only.",
        steps: [
          {
            title: "Check SES sending limits and verified identities",
            detail:
              "Confirm the SES sender identity is verified in the rotation Lambda's region and that the account is out of sandbox if recipients are external domains.",
          },
        ],
      };
  }
}

function buildVerificationRemediation(
  verification: VerificationOutcome | undefined,
  errorMessage: string,
): RemediationPlan {
  if (!verification) {
    return {
      summary: `Verification could not run: ${errorMessage}`,
      steps: [
        {
          title: "Re-trigger rotation manually",
          detail:
            "Re-save the secret value in Secrets Manager to fire the EventBridge rule again. If verification fails the same way, fall back to invoking configureConnectors manually and watching its logs.",
        },
      ],
    };
  }

  if (verification.status === "not_found") {
    return {
      summary:
        "The Kafka Connect connector was not found. Either configureConnectors has never run successfully, or the connector name has drifted.",
      steps: [
        {
          title: "Invoke configureConnectors manually",
          detail:
            "Run the configureConnectors Lambda from the console. If it succeeds, re-run verification. If not, follow its logs.",
        },
      ],
    };
  }

  if (verification.status === "timeout") {
    return {
      summary: `Verification timed out. Last observed connector state: ${verification.lastConnectorState ?? "unknown"}.`,
      steps: [
        {
          title: "Increase verification time or check task startup",
          detail:
            "Oracle JDBC tasks can take 30-90s to establish a pool. If the cluster is under load, increase the rotation Lambda timeout, or watch the connector status manually until it settles.",
        },
        verification.traceSnippet
          ? {
              title: "Inspect the Kafka Connect trace",
              detail: `Trace excerpt:\n${verification.traceSnippet}`,
            }
          : {
              title: "Tail Kafka Connect logs",
              detail:
                "Open /aws/fargate/appian-connector-{stage}-kafka-connect and look for ERROR or stack traces around the rotation time.",
            },
      ],
    };
  }

  if (verification.status !== "failed") {
    return {
      summary: `Unexpected verification outcome: ${(verification as { status: string }).status}.`,
      steps: [
        {
          title: "Inspect rotation Lambda logs",
          detail:
            "Open the rotation Lambda's CloudWatch log group for the most recent invocation to see the full event.",
        },
      ],
    };
  }

  const trace = verification.traceSnippet ?? "";
  const steps: RemediationStep[] = [];
  const matchedSpecific = appendSpecificDiagnoses(steps, trace);

  if (!matchedSpecific) {
    steps.push({
      title: "Inspect the full Kafka Connect status response",
      detail: trace
        ? `The connector reported state ${verification.connectorState ?? "unknown"} and tasks ${verification.taskStates.join(", ") || "(none)"}.\nTrace excerpt:\n${trace}`
        : `The connector reported state ${verification.connectorState ?? "unknown"} and tasks ${verification.taskStates.join(", ") || "(none)"}, with no trace string. Inspect /aws/fargate/appian-connector-{stage}-kafka-connect for context.`,
    });
  }

  return {
    summary: `The connector did not enter RUNNING state. connector=${verification.connectorState ?? "unknown"}, tasks=${verification.taskStates.join(",") || "(none)"}.`,
    steps,
  };
}

function appendSpecificDiagnoses(steps: RemediationStep[], trace: string): boolean {
  let matched = false;
  if (/ORA-01017/i.test(trace)) {
    matched = true;
    steps.push({
      title: "Oracle reported invalid username/password (ORA-01017)",
      detail:
        "The new password in the secret does not match what the database has. Re-check the value you saved against the DBA's record. If the DBA has also rotated the user password, save the new password you were given (not the old one). Re-save the secret to retry.",
    });
  }
  if (/ORA-12541|TNS:no listener/i.test(trace)) {
    matched = true;
    steps.push({
      title: "No listener at the database host (ORA-12541)",
      detail:
        "JDBC could not reach the database. Confirm the dbInfo secret's ip/port are correct and that the security group on the VPC allows egress to the DB.",
    });
  }
  if (/ORA-12514|listener does not currently know of service/i.test(trace)) {
    matched = true;
    steps.push({
      title: "Service name not registered (ORA-12514)",
      detail:
        "The Oracle listener does not know the service name in dbInfo.db. Confirm with the DBA that the SID/SERVICE_NAME is correct.",
    });
  }
  if (/IO Error|Socket read timed out|Connection reset/i.test(trace)) {
    matched = true;
    steps.push({
      title: "Network reachability issue",
      detail:
        "The connector could not maintain a socket to the database. Check VPC routing, security groups, and any NACL changes that happened around the rotation time.",
    });
  }
  if (/UnknownHostException/i.test(trace)) {
    matched = true;
    steps.push({
      title: "DNS lookup failed",
      detail:
        "The hostname in dbInfo.ip cannot be resolved from the VPC. Confirm DNS resolution is enabled on the VPC and the host is correct.",
    });
  }
  return matched;
}
