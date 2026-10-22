import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";
import * as fs from "node:fs";
import * as path from "node:path";

const connectorNamesPath = path.join(__dirname, "../../src/services/connector/libs/connector-names.json");

export function loadConnectorNames(): string[] {
  return Object.values(JSON.parse(fs.readFileSync(connectorNamesPath, "utf-8")) as Record<string, string>);
}

export function connectorShortName(connectorName: string): string {
  return connectorName.replace(/^source\.jdbc\./, "");
}

export interface ConnectorAlarmsProps {
  servicePrefix: string;
  alertsTopicArn: string;
  connectorNames: string[];
  healthCheckScheduleEnabled: boolean;
  testConnectorsFunctionName: string;
}

interface ConnectorMetricAlarm {
  suffix: string;
  metricSuffix: string;
  statistic: "Maximum" | "Sum";
  datapointsToAlarm: number;
  evaluationPeriods: number;
}

const CONNECTOR_METRIC_ALARMS: ConnectorMetricAlarm[] = [
  { suffix: "connector-down", metricSuffix: "failures", statistic: "Maximum", datapointsToAlarm: 3, evaluationPeriods: 5 },
  { suffix: "task-down", metricSuffix: "task_failures", statistic: "Maximum", datapointsToAlarm: 3, evaluationPeriods: 5 },
  { suffix: "oracle-auth", metricSuffix: "oracle_auth_failures", statistic: "Sum", datapointsToAlarm: 1, evaluationPeriods: 1 },
  { suffix: "restart-capped", metricSuffix: "restart_capped", statistic: "Maximum", datapointsToAlarm: 1, evaluationPeriods: 1 },
];

export function addConnectorAlarms(scope: Construct, props: ConnectorAlarmsProps): void {
  const { servicePrefix, alertsTopicArn } = props;
  const namePrefix = `${servicePrefix}-conn`;
  const actions = { alarmActions: [alertsTopicArn], okActions: [alertsTopicArn] };

  for (const connectorName of props.connectorNames) {
    const short = connectorShortName(connectorName);
    for (const alarm of CONNECTOR_METRIC_ALARMS) {
      new cloudwatch.CfnAlarm(scope, `ConnAlarm-${short}-${alarm.suffix}`, {
        ...actions,
        alarmName: `${namePrefix}-${short}-${alarm.suffix}`,
        namespace: servicePrefix,
        metricName: `${connectorName}_${alarm.metricSuffix}`,
        statistic: alarm.statistic,
        period: 60,
        evaluationPeriods: alarm.evaluationPeriods,
        datapointsToAlarm: alarm.datapointsToAlarm,
        threshold: 1,
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        treatMissingData: "notBreaching",
      });
    }
  }

  if (props.healthCheckScheduleEnabled) {
    new cloudwatch.CfnAlarm(scope, "ConnAlarm-health-check-missing", {
      ...actions,
      alarmName: `${namePrefix}-health-check-missing`,
      namespace: servicePrefix,
      metricName: "health_check_heartbeat",
      statistic: "SampleCount",
      period: 60,
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
      threshold: 1,
      comparisonOperator: "LessThanThreshold",
      treatMissingData: "breaching",
    });
  }

  new cloudwatch.CfnAlarm(scope, "ConnAlarm-health-check-errors", {
    ...actions,
    alarmName: `${namePrefix}-health-check-errors`,
    namespace: "AWS/Lambda",
    metricName: "Errors",
    dimensions: [{ name: "FunctionName", value: props.testConnectorsFunctionName }],
    statistic: "Sum",
    period: 60,
    evaluationPeriods: 3,
    datapointsToAlarm: 2,
    threshold: 1,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
    treatMissingData: "notBreaching",
  });
}
