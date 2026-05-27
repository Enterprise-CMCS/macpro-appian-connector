export interface DbInfoSecret {
  ip: string;
  port: string;
  db: string;
  user: string;
  password: string;
  schema: string;
}

export interface SecretsManagerEventDetail {
  eventName: string;
  eventSource: string;
  requestParameters?: {
    secretId?: string;
  };
  responseElements?: {
    arn?: string;
    name?: string;
  };
}

export interface SecretsManagerEvent {
  source: string;
  detail: SecretsManagerEventDetail;
  account?: string;
  region?: string;
  time?: string;
  id?: string;
}

export interface ParsedRotationTrigger {
  secretIdentifier: string;
  eventName: string;
  eventTime: string;
}

export type VerificationOutcome =
  | { status: "running" }
  | {
      status: "failed";
      connectorState: string | undefined;
      taskStates: ReadonlyArray<string>;
      traceSnippet: string | undefined;
    }
  | { status: "not_found"; message: string }
  | { status: "timeout"; lastConnectorState: string | undefined; traceSnippet: string | undefined };

export interface RemediationStep {
  title: string;
  detail: string;
}

export interface RemediationPlan {
  summary: string;
  steps: ReadonlyArray<RemediationStep>;
}

export type RotationPhase =
  | "parse_event"
  | "read_secret"
  | "update_lambda_env"
  | "invoke_configure_connectors"
  | "verify_connector"
  | "notify";

export interface RotationContext {
  stage: string;
  region: string;
  trigger: ParsedRotationTrigger;
}

export type RotationResult =
  | { kind: "success"; verification: Extract<VerificationOutcome, { status: "running" }>; context: RotationContext }
  | {
      kind: "failure";
      phase: RotationPhase;
      error: string;
      verification?: VerificationOutcome;
      remediation: RemediationPlan;
      context: RotationContext;
    };
