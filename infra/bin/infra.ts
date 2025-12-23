#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AppianAlertsMasterStack } from '../lib/appian-alerts-master-stack';
import { AppianConnectorStack } from '../lib/appian-connector-stack';
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
  new AppianAlertsMasterStack(app, `appian-alerts-${stage}`, stackProps);

  // Connector Stack - ECS Cluster, Service, Task Definition, Lambdas, CloudWatch Alarms
  // Migrated from serverless appian-connector-{stage} stack
  // Uses full environment configuration with secrets resolved from AWS Secrets Manager
  new AppianConnectorStack(app, `appian-connector-${stage}`, {
    ...stackProps,
    fullConfig,
  });

  app.synth();
}

main().catch((error) => {
  console.error('Error during CDK synthesis:', error);
  process.exit(1);
});
