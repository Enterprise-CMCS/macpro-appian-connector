import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AppianConnectorStack } from "../lib/appian-connector-stack";
import { FullEnvironmentConfig } from "../lib/environment-config";

export const baseConfig: FullEnvironmentConfig = {
  stage: "master",
  taskCpu: "1024",
  taskMemory: "2048",
  connectContainerCpu: 512,
  connectContainerMemory: 1024,
  instantClientContainerMemory: 512,
  healthCheckSchedule: "ENABLED",
  jiraStageLabel: null,
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
    password: "not-a-secret", // pragma: allowlist secret
    schema: "dbo",
  },
  iamPath: "/service-role/",
  iamPermissionsBoundary: "arn:aws:iam::123456789012:policy/Boundary",
  ecrImage: "123456789012.dkr.ecr.us-east-1.amazonaws.com/appian-connector:latest",
};

export function synthesizeTemplate(overrides: Partial<FullEnvironmentConfig> = {}): Template {
  const fullConfig = { ...baseConfig, ...overrides };
  const app = new cdk.App();
  const stack = new AppianConnectorStack(app, `appian-connector-${fullConfig.stage}`, {
    env: { account: "123456789012", region: "us-east-1" },
    fullConfig,
  });
  return Template.fromStack(stack);
}
