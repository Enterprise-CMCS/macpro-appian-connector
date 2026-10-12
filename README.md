<h1 align="center" style="border-bottom: none;">macpro-appian-connector</h1>
<h3 align="center">A Kafka Connector to stream data changes from Appian to BigMAC.</h3>
<p align="center">
  <a href="https://github.com/Enterprise-CMCS/macpro-appian-connector/wiki">
    <img alt="Wiki" src="https://img.shields.io/badge/Docs-Wiki-blue.svg">
  </a>
  <a href="https://cmsgov.slack.com/archives/C04K1444K89">
    <img alt="Slack" src="https://img.shields.io/badge/Slack-channel-purple.svg">
  </a>
  <a href="https://codeclimate.com/github/Enterprise-CMCS/macpro-appian-connector/maintainability">
    <img alt="Maintainability" src="https://api.codeclimate.com/v1/badges/f7cce65e43346ac8e2c2/maintainability" />
  </a>
  <a href="https://dependabot.com/">
    <img alt="Dependabot" src="https://badgen.net/badge/Dependabot/enabled/green?icon=dependabot">
  </a>
  <a href="https://github.com/prettier/prettier">
    <img alt="code style: prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg?style=flat-square">
  </a>
  <a href="https://github.com/semantic-release/semantic-release">
    <img alt="semantic-release: angular" src="https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release">
  </a>
</p>

---

### Documentation: [Wiki](https://github.com/Enterprise-CMCS/macpro-appian-connector/wiki) · [CDK migration guide](https://github.com/Enterprise-CMCS/macpro-appian-connector/wiki/CDK-Migration-Guide) · [Architecture diagram](https://github.com/Enterprise-CMCS/macpro-appian-connector/wiki) · [Database credential rotation runbook](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1504366491)

---

## Overview

A Kafka Connector to stream data changes from Appian to BigMAC.

<p align="center">
  <a href="https://github.com/Enterprise-CMCS/macpro-appian-connector/wiki">View architecture diagram in the Wiki →</a>
</p>

## Technology Stack

- **Infrastructure as Code**: AWS CDK (TypeScript)
- **Runtime**: Node.js 22.x, TypeScript
- **AWS Services**: ECS Fargate, Lambda, SNS, KMS, CloudWatch
- **Streaming**: Apache Kafka, Kafka Connect

## Quick Start

```bash
# Install dependencies
yarn install

# Deploy to master
run deploy --stage master

# Or deploy directly with CDK
cd infra
yarn build
npx cdk deploy appian-alerts-master appian-connector-master
```

## Project Structure

```
macpro-appian-connector/
├── infra/                    # AWS CDK infrastructure
│   ├── bin/                  # CDK app entry point
│   └── lib/                  # Stack definitions
├── src/
│   ├── types/                # Shared TypeScript types
│   ├── libs/                 # Shared libraries
│   └── services/
│       └── connector/
│           ├── handlers/     # Lambda handlers (TypeScript)
│           └── libs/         # Connector-specific libraries
```

## Alert email subscriptions

Connector alarms, including Oracle authentication and account-lock failures, publish to the SNS topic `Alerts-appian-alerts-<stage>` in that stage's account. The auth alarm watches `{connectorName}_oracle_auth_failures`. Other connector alarms use the same topic. Email subscriptions are added by hand and are not stored in this repository.

1. Subscribe with the AWS CLI. Use the profile for that stage, and replace the account id, stage, and email address.

   ```bash
   aws sns subscribe \
     --region us-east-1 \
     --topic-arn arn:aws:sns:us-east-1:ACCOUNT_ID:Alerts-appian-alerts-STAGE \
     --protocol email \
     --notification-endpoint you@example.com
   ```

2. Open the confirmation message AWS sends and confirm the subscription. Until that confirmation, the address does not receive alarms.

Each person needs their own subscription on that topic.

## Contributing

Work items for this project are tracked in Jira. Check out the [project kanban board](https://qmacbis.atlassian.net/jira/software/c/projects/OY2/boards/240) to view all work items affecting this repo.

If you don't have access to Jira, would like access to Jira, or would like to drop us an idea without pursuing Jira access, please visit the [slack channel](https://cmsgov.slack.com/archives/C04K1444K89).

## License

[![License](https://img.shields.io/badge/License-CC0--1.0--Universal-blue.svg)](https://creativecommons.org/publicdomain/zero/1.0/legalcode)

See [LICENSE](LICENSE) for full details.
