#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AppianAlertsMasterStack } from '../lib/appian-alerts-master-stack';
import { AppianConnectorStack } from '../lib/appian-connector-stack';
import { AppianPwRotationStack } from '../lib/appian-pw-rotation-stack';
import { getFullEnvironmentConfig } from '../lib/environment-config';

async function main() {
  const app = new cdk.App();

  // Get stage from CDK context or environment variable, default to 'master'
  const stage = app.node.tryGetContext('stage') || process.env.STAGE_NAME || 'master';

  // Load full environment configuration including secrets from AWS Secrets Manager
  // This uses the fallback pattern: appian/{stage}/... -> appian/default/...
  const fullConfig = await getFullEnvironmentConfig(stage);

  // Stack configuration with bootstrap qualifier "one"
  // This matches the existing CDK bootstrap stack in the AWS account
  const stackProps: cdk.StackProps = {
    synthesizer: new cdk.DefaultStackSynthesizer({
      qualifier: 'one',
    }),
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    },
  };

  // Alerts Stack - SNS Topic, KMS Key, Topic Policy
  // Migrated from serverless appian-alerts-{stage} stack
  new AppianAlertsMasterStack(app, `appian-alerts-${stage}`, {
    ...stackProps,
    stage,
  });

  // Connector Stack - ECS Cluster, Service, Task Definition, Lambdas, CloudWatch Alarms
  // Migrated from serverless appian-connector-{stage} stack
  // Uses full environment configuration with secrets resolved from AWS Secrets Manager
  const connectorStack = new AppianConnectorStack(app, `appian-connector-${stage}`, {
    ...stackProps,
    fullConfig,
  });

  // Password Rotation Stack - automated handling when the appian/{stage}/dbInfo
  // secret is updated in the AWS console. Optional: opt in by setting
  // PW_ROTATION_SENDER (verified SES sender identity).
  const notificationSender = process.env.PW_ROTATION_SENDER;
  if (notificationSender) {
    const rotationStack = new AppianPwRotationStack(app, `appian-pw-rotation-${stage}`, {
      ...stackProps,
      fullConfig,
      configureConnectorsFunctionName: connectorStack.configureConnectorsLambdaName,
      kafkaConnectClusterName: connectorStack.kafkaConnectClusterName,
      kafkaConnectServiceName: connectorStack.kafkaConnectServiceName,
      connectorName: 'source.jdbc.appian-connector-dbo-1',
      configureConnectorsLambdaSecurityGroupId:
        connectorStack.configureConnectorsLambdaSecurityGroupId,
      notificationSender,
      initialRecipients: process.env.PW_ROTATION_INITIAL_RECIPIENTS,
    });
    rotationStack.addDependency(connectorStack);
  }

  app.synth();
}

main().catch((error) => {
  console.error('Error during CDK synthesis:', error);
  process.exit(1);
});
