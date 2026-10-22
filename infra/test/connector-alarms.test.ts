import { Match } from "aws-cdk-lib/assertions";
import { connectorShortName, loadConnectorNames } from "../lib/connector-alarms";
import { environmentConfigs } from "../lib/environment-config";
import { synthesizeTemplate } from "./fixtures";

const topic = "arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-master";

describe("connector alarms", () => {
  it("creates named connection alarms for every connector", () => {
    const template = synthesizeTemplate();
    const names = loadConnectorNames();
    expect(names).toContain("source.jdbc.appian-connector-dbo-1");

    for (const name of names) {
      const short = connectorShortName(name);
      for (const [suffix, metric, statistic] of [
        ["connector-down", `${name}_failures`, "Maximum"],
        ["task-down", `${name}_task_failures`, "Maximum"],
        ["oracle-auth", `${name}_oracle_auth_failures`, "Sum"],
        ["restart-capped", `${name}_restart_capped`, "Maximum"],
      ]) {
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
          AlarmName: `appian-connector-master-conn-${short}-${suffix}`,
          MetricName: metric,
          Namespace: "appian-connector-master",
          Statistic: statistic,
          Period: 60,
          Threshold: 1,
          AlarmActions: [topic],
          OKActions: [topic],
          TreatMissingData: "notBreaching",
        });
      }
    }
  });

  it("waits 3 of 5 minutes before alarming on a down connector or task", () => {
    const template = synthesizeTemplate();
    for (const suffix of ["connector-down", "task-down"]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: `appian-connector-master-conn-appian-connector-dbo-1-${suffix}`,
        DatapointsToAlarm: 3,
        EvaluationPeriods: 5,
      });
    }
  });

  it("no longer references the old connector name", () => {
    const alarms = synthesizeTemplate().findResources("AWS::CloudWatch::Alarm");
    expect(JSON.stringify(alarms)).not.toContain("appian-dbo-1");
  });

  it("alarms when the health check stops reporting, only when the schedule is enabled", () => {
    synthesizeTemplate().hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "appian-connector-master-conn-health-check-missing",
      MetricName: "health_check_heartbeat",
      Statistic: "SampleCount",
      ComparisonOperator: "LessThanThreshold",
      Threshold: 1,
      EvaluationPeriods: 5,
      DatapointsToAlarm: 5,
      TreatMissingData: "breaching",
      AlarmActions: [topic],
      OKActions: [topic],
    });

    const disabled = synthesizeTemplate({ stage: "val", healthCheckSchedule: "DISABLED" });
    const missing = disabled.findResources("AWS::CloudWatch::Alarm", {
      Properties: { AlarmName: "appian-connector-val-conn-health-check-missing" },
    });
    expect(Object.keys(missing)).toHaveLength(0);
  });

  it("alarms on testConnectors Lambda errors", () => {
    synthesizeTemplate().hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "appian-connector-master-conn-health-check-errors",
      Namespace: "AWS/Lambda",
      MetricName: "Errors",
      Dimensions: [{ Name: "FunctionName", Value: "appian-connector-master-testConnectors" }],
      Statistic: "Sum",
      DatapointsToAlarm: 2,
      EvaluationPeriods: 3,
    });
  });

  it("sets the schedule rule state from config", () => {
    synthesizeTemplate().hasResourceProperties("AWS::Events::Rule", { ScheduleExpression: "cron(0/1 * ? * * *)", State: "ENABLED" });
    synthesizeTemplate({ stage: "val", healthCheckSchedule: "DISABLED" }).hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(0/1 * ? * * *)",
      State: "DISABLED",
    });
  });

  it("matches the live schedule state per stage", () => {
    expect(environmentConfigs.master.healthCheckSchedule).toBe("ENABLED");
    expect(environmentConfigs.val.healthCheckSchedule).toBe("ENABLED");
    expect(environmentConfigs.production.healthCheckSchedule).toBe("DISABLED");
  });

  it("lets testConnectors read restart counts with a cap of 3", () => {
    const template = synthesizeTemplate();
    template.hasResourceProperties("AWS::IAM::Role", {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([Match.objectLike({ Action: ["cloudwatch:PutMetricData", "cloudwatch:GetMetricStatistics"] })]),
          }),
        }),
      ]),
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "appian-connector-master-testConnectors",
      Environment: { Variables: Match.objectLike({ maxRestartsPerHour: "3" }) },
    });
  });
});
