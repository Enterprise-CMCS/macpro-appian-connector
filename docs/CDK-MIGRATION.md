# CDK Migration Guide

This document describes the migration of the Appian Connector application from Serverless Framework to AWS CDK, and provides instructions for promoting changes through environments.

## Table of Contents

- [Migration Summary](#migration-summary)
- [What Changed](#what-changed)
- [Architecture Overview](#architecture-overview)
- [Deploying to Val and Production](#deploying-to-val-and-production)
- [Rollback Procedures](#rollback-procedures)
- [Troubleshooting](#troubleshooting)

---

## Migration Summary

### Migration Approach: Stack Takeover

The migration used AWS CDK's **Stack Takeover** approach via `cdk migrate --from-stack`. This method:

- **Preserves all existing resources** without recreation
- **Maintains Kafka Connect state** (offsets stored in Kafka topics, not CloudFormation)
- **Zero downtime** for producers and consumers
- **No data loss** for consumer groups or topic offsets

### Migration Date

- **Master environment**: Deployed December 2024
- **Val environment**: Pending promotion
- **Production environment**: Pending promotion

### Key Decisions Made

1. **Removed ephemeral environments**: Only `master`, `val`, and `production` branches trigger deployments
2. **Removed Kafka topic custom resources**: Topics already exist in all environments; `CreateTopics` and `CleanupTopics` Lambda-backed custom resources were removed
3. **TypeScript conversion**: All JavaScript handlers and libraries converted to TypeScript with strong types
4. **Bootstrap qualifier**: Using existing CDK bootstrap stack with qualifier `one`

---

## What Changed

### Infrastructure (No Changes to Deployed Resources)

The CDK migration preserved all CloudFormation logical IDs and resource configurations. The deployed infrastructure is identical before and after migration.

| Resource | Status |
|----------|--------|
| ECS Cluster | Unchanged |
| ECS Service | Unchanged |
| ECS Task Definition | Unchanged |
| Lambda Functions (4) | Unchanged |
| Security Groups (3) | Unchanged |
| CloudWatch Alarms (6) | Unchanged |
| EventBridge Rules | Unchanged |
| SNS Topic | Unchanged |
| KMS Key | Unchanged |

### Removed Resources (Intentional)

| Resource | Reason |
|----------|--------|
| `CreateTopics` Custom Resource | Topics already exist in all environments |
| `CleanupTopics` Custom Resource | Only ran on `isDev` condition (never in val/prod) |
| `isDev` Condition | No longer needed |

### Code Changes

| Before | After |
|--------|-------|
| Serverless Framework | AWS CDK (TypeScript) |
| JavaScript handlers | TypeScript handlers |
| `serverless.yml` files | CDK stack definitions |
| `serverless-compose.yml` | CDK app entry point |

### File Structure

```
macpro-appian-connector/
├── infra/                              # NEW: CDK infrastructure
│   ├── bin/infra.ts                    # CDK app entry point
│   ├── lib/
│   │   ├── appian-alerts-master-stack.ts
│   │   └── appian-connector-master-stack.ts
│   ├── cdk.json
│   └── package.json
├── src/
│   ├── types/index.ts                  # NEW: Shared TypeScript types
│   ├── libs/                           # CONVERTED: JS → TS
│   │   ├── cloudwatch-lib.ts
│   │   ├── connect-lib.ts
│   │   ├── ecs-lib.ts
│   │   └── topics-lib.ts
│   └── services/connector/
│       ├── handlers/                   # CONVERTED: JS → TS
│       │   ├── cleanupKafka.ts
│       │   ├── configureConnectors.ts
│       │   ├── createTopics.ts
│       │   └── testConnectors.ts
│       └── libs/
│           ├── connectors.ts
│           └── query.ts
└── package.json                        # Updated: v1.0.0, CDK deps
```

---

## Architecture Overview

![Architecture](assets/architecture.png)

### Stacks

| Stack Name | Resources | Purpose |
|------------|-----------|---------|
| `appian-alerts-{stage}` | SNS Topic, KMS Key | Alert notifications |
| `appian-connector-{stage}` | ECS, Lambda, CloudWatch | Kafka Connect service |

### Kafka Connect State Preservation

Kafka Connect stores all state in Kafka topics (not CloudFormation):

| Topic | Purpose |
|-------|---------|
| `mgmt.connect.appian-connector-{stage}.offsets` | Consumer offsets |
| `mgmt.connect.appian-connector-{stage}.config` | Connector configurations |
| `mgmt.connect.appian-connector-{stage}.status` | Connector status |

This means:
- ECS task restarts do not lose state
- CloudFormation updates do not affect offsets
- Producers and consumers are unaffected by infrastructure changes

---

## Deploying to Val and Production

### Prerequisites

1. AWS CLI configured with appropriate credentials
2. Node.js 20.x installed
3. Yarn installed

### Promotion Process

#### Step 1: Create Pull Request

Create a PR from `master` → `val` (or `val` → `production`).

#### Step 2: Review CDK Diff (Optional but Recommended)

Before merging, review what will change:

```bash
# Configure AWS credentials for target environment
export AWS_PROFILE=val  # or production

# Check the diff
cd infra
yarn build
npx cdk diff appian-alerts-val appian-connector-val
```

**Expected output for first deployment to val/production:**
- Template differences (intrinsic functions resolved differently)
- Bootstrap parameter additions
- **NO resource replacements** (critical)

#### Step 3: Merge PR

Merge the PR. GitHub Actions will automatically:
1. Run `yarn install`
2. Build the CDK project
3. Deploy both stacks

#### Step 4: Verify Deployment

After deployment completes:

```bash
# Check ECS service status
aws ecs describe-services \
  --cluster appian-connector-{stage}-connect \
  --services kafka-connect \
  --query "services[0].{status:status,runningCount:runningCount}"

# Check connector health
aws lambda invoke \
  --function-name appian-connector-{stage}-testConnectors \
  --payload '{}' /dev/stdout

# View recent logs
aws logs tail /aws/lambda/appian-connector-{stage}-testConnectors --since 5m
```

### Manual Deployment (If Needed)

```bash
# Configure AWS credentials
export AWS_PROFILE=val  # or production

cd /path/to/macpro-appian-connector/infra
yarn install
yarn build

# Deploy to val
npx cdk deploy appian-alerts-val appian-connector-val --require-approval never

# Deploy to production
npx cdk deploy appian-alerts-production appian-connector-production --require-approval never
```

### Environment-Specific Stack Names

| Environment | Alerts Stack | Connector Stack |
|-------------|--------------|-----------------|
| Master | `appian-alerts-master` | `appian-connector-master` |
| Val | `appian-alerts-val` | `appian-connector-val` |
| Production | `appian-alerts-production` | `appian-connector-production` |

---

## Rollback Procedures

### Option 1: CloudFormation Rollback

If a deployment fails mid-way:

```bash
aws cloudformation rollback-stack --stack-name appian-connector-{stage}
```

### Option 2: Revert Git Commit

If a deployment succeeds but causes issues:

1. Revert the merge commit in Git
2. Push to trigger a new deployment with the previous code

### Option 3: Manual CDK Deployment

Deploy a specific previous version:

```bash
git checkout <previous-commit>
cd infra
yarn build
npx cdk deploy appian-alerts-{stage} appian-connector-{stage}
```

### Kafka Connect Recovery

If the Kafka Connect service needs to be restarted:

```bash
# Force a new deployment (restarts tasks)
aws ecs update-service \
  --cluster appian-connector-{stage}-connect \
  --service kafka-connect \
  --force-new-deployment
```

The connector will automatically:
1. Reconnect to the Kafka brokers
2. Resume from the last committed offset
3. Continue processing without data loss

---

## Troubleshooting

### CDK Diff Shows Replacements

If `cdk diff` shows resource replacements (especially for ECS):

1. **DO NOT DEPLOY** until investigated
2. Check logical IDs match between CDK code and deployed stack
3. Verify the stack was properly taken over with `migrate.json`

### ECS Service Not Starting

```bash
# Check task status
aws ecs describe-tasks \
  --cluster appian-connector-{stage}-connect \
  --tasks $(aws ecs list-tasks --cluster appian-connector-{stage}-connect --query 'taskArns[0]' --output text)

# Check CloudWatch logs
aws logs tail /aws/ecs/appian-connector-{stage}-connect --since 30m
```

### Connector Not Running

```bash
# Invoke the configure function to re-apply connector config
aws lambda invoke \
  --function-name appian-connector-{stage}-configureConnectors \
  --payload '{}' /dev/stdout

# Check connector status
aws lambda invoke \
  --function-name appian-connector-{stage}-testConnectors \
  --payload '{}' /dev/stdout
```

### Bootstrap Qualifier Issues

If deployment fails with bootstrap-related errors:

1. Verify the bootstrap stack exists: `aws ssm get-parameter --name /cdk-bootstrap/one/version`
2. Ensure `cdk.json` has `@aws-cdk/core:bootstrapQualifier: "one"`
3. Ensure `bin/infra.ts` uses `DefaultStackSynthesizer` with `qualifier: "one"`

---

## Contact

For issues or questions:
- Slack: [#macpro-appian-connector](https://cmsgov.slack.com/archives/C04K1444K89)
- Jira: [Project Board](https://qmacbis.atlassian.net/jira/software/c/projects/OY2/boards/240)

