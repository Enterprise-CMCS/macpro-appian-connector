import { Match, Template } from "aws-cdk-lib/assertions";
import { environmentConfigs } from "../lib/environment-config";
import { synthesizeTemplate } from "./fixtures";

function ecsFailureRule(template: Template) {
  return Object.values(template.findResources("AWS::Events::Rule")).find(
    (rule) => rule.Properties.Description === "Connector Task Failure Event Rule"
  );
}

describe("jira notifier", () => {
  it("is configured for val and production only", () => {
    expect(environmentConfigs.master.jiraStageLabel).toBeNull();
    expect(environmentConfigs.val.jiraStageLabel).toBe("VAL");
    expect(environmentConfigs.production.jiraStageLabel).toBe("PROD");
  });

  it("is not created when jiraStageLabel is null", () => {
    const template = synthesizeTemplate();
    expect(Object.keys(template.findResources("AWS::SQS::Queue"))).toHaveLength(0);
    expect(JSON.stringify(template.findResources("AWS::Lambda::Function"))).not.toContain("jiraNotifier");
    expect(ecsFailureRule(template)?.Properties.Targets).toHaveLength(1);
  });

  describe("in val", () => {
    let template: Template;

    beforeAll(() => {
      template = synthesizeTemplate({ stage: "val", healthCheckSchedule: "DISABLED", jiraStageLabel: "VAL" });
    });

    it("creates the notifier with serialized concurrency and the Jira settings", () => {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "appian-connector-val-jiraNotifier",
        Runtime: "nodejs24.x",
        ReservedConcurrentExecutions: 1,
        Timeout: 30,
        Environment: {
          Variables: {
            stage: "val",
            servicePrefix: "appian-connector-val",
            jiraStageLabel: "VAL",
            jiraSecretId: "appian/val/jira",
          },
        },
      });
    });

    it("retries twice, then sends the event to an encrypted dead-letter queue that alarms to email", () => {
      template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
        MaximumRetryAttempts: 2,
        DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
      });
      template.hasResourceProperties("AWS::SQS::Queue", { QueueName: "appian-connector-val-jiraNotifier-dlq", SqsManagedSseEnabled: true });
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: "appian-connector-val-jiraNotifier-dlq",
        Namespace: "AWS/SQS",
        MetricName: "ApproximateNumberOfMessagesVisible",
        AlarmActions: ["arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-val"],
      });
    });

    it("listens only to connection alarms entering ALARM or OK", () => {
      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: {
          source: ["aws.cloudwatch"],
          "detail-type": ["CloudWatch Alarm State Change"],
          detail: { alarmName: [{ prefix: "appian-connector-val-conn-" }], state: { value: ["ALARM", "OK"] } },
        },
      });
    });

    it("also receives ECS task-stopped events", () => {
      const targets = ecsFailureRule(template)?.Properties.Targets;
      expect(targets).toHaveLength(2);
      expect(targets).toEqual(expect.arrayContaining([expect.objectContaining({ Id: "JiraNotifierEcsTaskFailure" })]));
      template.hasResourceProperties("AWS::Lambda::Permission", {
        Principal: "events.amazonaws.com",
        SourceArn: { "Fn::GetAtt": ["ECSFailureEventRule", "Arn"] },
      });
    });

    it("can read only its own Jira secret", () => {
      const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
      expect(policies).toContain("secretsmanager:GetSecretValue");
      expect(policies).toContain("secret:appian/val/jira-*");
      expect(policies).not.toContain("secret:*");
    });

    it("keeps CPU, memory, and log-count alarms out of the -conn- prefix", () => {
      for (const alarm of Object.values(template.findResources("AWS::CloudWatch::Alarm"))) {
        const name = alarm.Properties.AlarmName;
        if (typeof name === "string" && /CPUUtilization|MemoryUtilization|ConnectorLogs/.test(name)) {
          expect(name).not.toContain("-conn-");
        }
      }
    });
  });

  it("labels production tickets PROD", () => {
    synthesizeTemplate({ stage: "production", healthCheckSchedule: "DISABLED", jiraStageLabel: "PROD" }).hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "appian-connector-production-jiraNotifier",
      Environment: { Variables: Match.objectLike({ jiraStageLabel: "PROD", jiraSecretId: "appian/production/jira" }) },
    });
  });
});
