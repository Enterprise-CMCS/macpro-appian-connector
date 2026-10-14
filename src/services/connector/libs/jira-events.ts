export type ConnectorAlarmKind = "connector-down" | "task-down" | "oracle-auth" | "restart-capped";
export type StageAlarmKind = "health-check-missing" | "health-check-errors";

const CONNECTOR_ALARM_KINDS: readonly ConnectorAlarmKind[] = ["connector-down", "task-down", "oracle-auth", "restart-capped"];
const STAGE_ALARM_KINDS: readonly StageAlarmKind[] = ["health-check-missing", "health-check-errors"];

export const ECS_WORKER_STOPPED_KEY = "ecs-worker-stopped";

export type AlarmSubject =
  | { type: "connector"; kind: ConnectorAlarmKind; short: string }
  | { type: "stage"; kind: StageAlarmKind }
  | { type: "ecs-worker-stopped" };

export interface AlarmStateChangeEvent {
  "detail-type": "CloudWatch Alarm State Change";
  time: string;
  region: string;
  detail: {
    alarmName: string;
    state: { value: string; reason: string; timestamp?: string };
    configuration?: {
      metrics?: Array<{ metricStat?: { metric?: { namespace?: string; name?: string }; period?: number; stat?: string } }>;
    };
  };
}

export interface EcsTaskStateChangeEvent {
  "detail-type": "ECS Task State Change";
  time: string;
  region: string;
  detail: { clusterArn: string; taskArn?: string; lastStatus: string; stoppedReason?: string; stoppedAt?: string };
}

export type NotifierEvent = AlarmStateChangeEvent | EcsTaskStateChangeEvent;

export interface Notice {
  key: string;
  subject: AlarmSubject;
  state: "ALARM" | "OK";
  reason: string;
  time: string;
  region: string;
  metric?: string;
}

export function parseAlarmName(alarmName: string, servicePrefix: string): AlarmSubject | undefined {
  const marker = `${servicePrefix}-conn-`;
  if (!alarmName.startsWith(marker)) {
    return undefined;
  }
  const rest = alarmName.slice(marker.length);

  const stageKind = STAGE_ALARM_KINDS.find((kind) => rest === kind);
  if (stageKind) {
    return { type: "stage", kind: stageKind };
  }

  const connectorKind = CONNECTOR_ALARM_KINDS.find((kind) => rest.endsWith(`-${kind}`));
  if (!connectorKind) {
    return undefined;
  }
  const short = rest.slice(0, -(connectorKind.length + 1));
  return short ? { type: "connector", kind: connectorKind, short } : undefined;
}

function connectorAlarmTitle(kind: ConnectorAlarmKind, short: string): string {
  switch (kind) {
    case "connector-down":
      return `${short} connector is not RUNNING`;
    case "task-down":
      return `${short} task is not RUNNING`;
    case "oracle-auth":
      return `${short} Oracle login rejected or account locked`;
    case "restart-capped":
      return `${short} restart limit reached`;
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled connector alarm kind ${String(unhandled)}`);
    }
  }
}

function stageAlarmTitle(kind: StageAlarmKind): string {
  switch (kind) {
    case "health-check-missing":
      return "Health check has stopped reporting";
    case "health-check-errors":
      return "Health check Lambda is failing";
    default: {
      const unhandled: never = kind;
      throw new Error(`Unhandled stage alarm kind ${String(unhandled)}`);
    }
  }
}

export function subjectTitle(subject: AlarmSubject): string {
  switch (subject.type) {
    case "connector":
      return connectorAlarmTitle(subject.kind, subject.short);
    case "stage":
      return stageAlarmTitle(subject.kind);
    case "ecs-worker-stopped":
      return "Kafka Connect worker task stopped";
    default: {
      const unhandled: never = subject;
      throw new Error(`Unhandled alarm subject ${JSON.stringify(unhandled)}`);
    }
  }
}

export function toNotice(event: NotifierEvent, servicePrefix: string): Notice | undefined {
  switch (event["detail-type"]) {
    case "CloudWatch Alarm State Change": {
      const subject = parseAlarmName(event.detail.alarmName, servicePrefix);
      const state = event.detail.state.value;
      if (!subject || (state !== "ALARM" && state !== "OK")) {
        return undefined;
      }
      const metricStat = event.detail.configuration?.metrics?.[0]?.metricStat;
      return {
        key: event.detail.alarmName,
        subject,
        state,
        reason: event.detail.state.reason,
        time: event.detail.state.timestamp ?? event.time,
        region: event.region,
        metric: metricStat?.metric?.name
          ? `${metricStat.metric.namespace}/${metricStat.metric.name} (${metricStat.stat}, period ${metricStat.period} seconds)`
          : undefined,
      };
    }
    case "ECS Task State Change":
      return {
        key: ECS_WORKER_STOPPED_KEY,
        subject: { type: "ecs-worker-stopped" },
        state: "ALARM",
        reason: `Task ${event.detail.taskArn ?? "unknown"} stopped: ${event.detail.stoppedReason ?? "no reason given"}`,
        time: event.detail.stoppedAt ?? event.time,
        region: event.region,
      };
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled event ${JSON.stringify(unhandled)}`);
    }
  }
}
