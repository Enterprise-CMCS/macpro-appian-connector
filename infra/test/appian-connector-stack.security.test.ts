import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AppianConnectorStack } from "../lib/appian-connector-stack";
import { FullEnvironmentConfig } from "../lib/environment-config";

const fullConfig: FullEnvironmentConfig = {
  stage: "master",
  taskCpu: "1024",
  taskMemory: "2048",
  connectContainerCpu: 512,
  connectContainerMemory: 1024,
  instantClientContainerMemory: 512,
  vpc: {
    id: "vpc-12345678",
    dataSubnets: ["subnet-data-a", "subnet-data-b", "subnet-data-c"],
    privateSubnets: ["subnet-private-a", "subnet-private-b", "subnet-private-c"],
    publicSubnets: ["subnet-public-a", "subnet-public-b", "subnet-public-c"],
  },
  brokerString: "broker-1:9092,broker-2:9092",
  dbInfo: {
    ip: "127.0.0.1",
    port: "5432",
    db: "appian",
    user: "connector",
    password: "not-a-secret",
    schema: "dbo",
  },
  iamPath: "/service-role/",
  iamPermissionsBoundary: "arn:aws:iam::123456789012:policy/Boundary",
  ecrImage: "123456789012.dkr.ecr.us-east-1.amazonaws.com/appian-connector:latest",
};

function synthesizeTemplate() {
  const app = new cdk.App();
  const stack = new AppianConnectorStack(app as cdk.App, "appian-connector-master", {
    env: {
      account: "123456789012",
      region: "us-east-1",
    },
    fullConfig,
  });

  return Template.fromStack(stack);
}

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
});
