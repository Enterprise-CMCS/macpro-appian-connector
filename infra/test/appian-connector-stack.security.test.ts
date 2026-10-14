import { Match } from "aws-cdk-lib/assertions";
import { synthesizeTemplate } from "./fixtures";

describe("AppianConnectorStack security controls", () => {
  it("allows CloudWatch Logs to use the connector log encryption key", () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties("AWS::KMS::Key", {
      KeyPolicy: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: "AllowCloudWatchLogsUseOfKey",
            Effect: "Allow",
            Principal: {
              Service: "logs.us-east-1.amazonaws.com",
            },
            Action: Match.arrayWith(["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey*", "kms:Describe*"]),
            Condition: {
              ArnLike: {
                "kms:EncryptionContext:aws:logs:arn": Match.anyValue(),
              },
            },
          }),
        ]),
      },
    });
  });

  it("encrypts connector log groups and sets retention", () => {
    const template = synthesizeTemplate();

    for (const logGroupName of [
      "/aws/lambda/appian-connector-master-configureConnectors",
      "/aws/lambda/appian-connector-master-testConnectors",
      "/aws/fargate/appian-connector-master-kafka-connect",
    ]) {
      template.hasResourceProperties("AWS::Logs::LogGroup", {
        LogGroupName: logGroupName,
        KmsKeyId: Match.anyValue(),
        RetentionInDays: 30,
      });
    }
  });

  it("alarms on oracle auth failures through the existing alerts topic", () => {
    const template = synthesizeTemplate();
    const alarms = template.findResources("AWS::CloudWatch::Alarm");

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "appian-connector-master-conn-appian-connector-dbo-1-oracle-auth",
      AlarmActions: ["arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-master"],
      OKActions: ["arn:aws:sns:us-east-1:123456789012:Alerts-appian-alerts-master"],
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      DatapointsToAlarm: 1,
      EvaluationPeriods: 1,
      MetricName: "source.jdbc.appian-connector-dbo-1_oracle_auth_failures",
      Namespace: "appian-connector-master",
      Period: 60,
      Statistic: "Sum",
      Threshold: 1,
      TreatMissingData: "notBreaching",
    });

    const oracleErrorAlarms = Object.values(alarms).filter((alarm) => {
      const metricName = alarm.Properties?.MetricName;
      return typeof metricName === "string" && metricName.includes("oracle_errors");
    });
    expect(oracleErrorAlarms).toHaveLength(0);
  });

  it("uses the stack-managed Lambda execution role ARN for connector functions", () => {
    const template = synthesizeTemplate();

    for (const functionName of [
      "appian-connector-master-configureConnectors",
      "appian-connector-master-testConnectors",
    ]) {
      template.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: functionName,
        Role: {
          "Fn::GetAtt": ["IamRoleLambdaExecution", "Arn"],
        },
      });
    }
  });
});
