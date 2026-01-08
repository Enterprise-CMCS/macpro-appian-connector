# Appian Connector CDK Infrastructure

This directory contains the AWS CDK infrastructure code for the Appian Connector application.

## Architecture

The infrastructure consists of two CloudFormation stacks:

### appian-alerts-{stage}

- **SNS Topic**: For ECS failure alerts
- **KMS Key**: Encryption for SNS messages
- **SNS Topic Policy**: Allows EventBridge to publish to the topic

### appian-connector-{stage}

- **ECS Cluster**: Runs the Kafka Connect worker
- **ECS Service & Task Definition**: Fargate-based Kafka Connect
- **Lambda Functions**:
  - `configureConnectors`: Configures Kafka connectors
  - `testConnectors`: Monitors connector health and sends metrics
  - `createTopics`: (Legacy) Creates Kafka topics
  - `cleanupKafka`: (Legacy) Cleans up Kafka topics
- **Security Groups**: Network isolation for Lambda and ECS
- **CloudWatch Alarms**: Monitoring for errors, warnings, CPU, and memory
- **EventBridge Rules**: Scheduled execution and failure notifications

## Prerequisites

- Node.js 20.x
- Yarn
- AWS CLI configured with appropriate credentials
- CDK Bootstrap stack with qualifier `one` (already deployed in target accounts)

## Commands

```bash
# Install dependencies
yarn install

# Build TypeScript
yarn build

# Synthesize CloudFormation templates
npx cdk synth

# Compare with deployed stacks
npx cdk diff

# Deploy all stacks
npx cdk deploy --all

# Deploy specific stacks
npx cdk deploy appian-alerts-master appian-connector-master

# Destroy stacks (use with caution!)
npx cdk destroy appian-connector-master appian-alerts-master --force
```

## Configuration

### Bootstrap Qualifier

This project uses the custom bootstrap qualifier `one` to share bootstrap resources with other CDK projects in the same AWS account. This is configured in:

- `cdk.json`: `@aws-cdk/core:bootstrapQualifier: "one"`
- `bin/infra.ts`: `DefaultStackSynthesizer` with `qualifier: "one"`

### Environment Variables

The stacks require the following AWS environment:
- `CDK_DEFAULT_ACCOUNT`: AWS account ID
- `CDK_DEFAULT_REGION`: AWS region (defaults to `us-east-1`)

## Stack Naming Convention

Stack names follow the pattern: `appian-{service}-{stage}`

- `appian-alerts-master`
- `appian-alerts-val`
- `appian-alerts-production`
- `appian-connector-master`
- `appian-connector-val`
- `appian-connector-production`

## Migration Notes

This infrastructure was migrated from Serverless Framework to AWS CDK using the `cdk migrate --from-stack` approach. The migration preserved all existing resources and their logical IDs to ensure zero downtime.

Key considerations:
- All Kafka topic offsets are stored in Kafka itself, not CloudFormation
- ECS Task Definitions maintain backward compatibility
- Lambda function names are preserved for existing integrations
