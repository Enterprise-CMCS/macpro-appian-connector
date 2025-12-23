#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { AppianAlertsMasterStack } from '../lib/appian-alerts-master-stack';
import { AppianConnectorMasterStack } from '../lib/appian-connector-master-stack';

const app = new cdk.App();

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
// Migrated from serverless appian-alerts-master stack
new AppianAlertsMasterStack(app, 'appian-alerts-master', stackProps);

// Connector Stack - ECS Cluster, Service, Task Definition, Lambdas, CloudWatch Alarms
// Migrated from serverless appian-connector-master stack
new AppianConnectorMasterStack(app, 'appian-connector-master', stackProps);
