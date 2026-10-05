## Learned User Preferences

- Open pull requests against `master`.
- Do not add a frontend page, banner, or feature flag for credential-change downtime unless directed.

## Learned Workspace Facts

- Connector DB credentials live in AWS Secrets Manager at `appian/{stage}/dbInfo` (JSON `password` field), not SSM.
- `configureConnectors` reads `legacydbPassword` from its Lambda environment, which is set at deploy, not from Secrets Manager at runtime.
- Database username and password changes are manual. Full steps are on the Confluence page: https://confluenceent.cms.gov/pages/viewpage.action?pageId=1504366491. Do not copy account IDs, secret values, or EventBridge physical names into this file.
- The automated credential updater and its CloudFormation stack have been removed. Do not reintroduce an automatic password updater. Credential changes stay manual.
- Lambda names: `appian-connector-production-configureConnectors`, `appian-connector-val-configureConnectors`, `appian-connector-master-configureConnectors`, `appian-connector-production-testConnectors`, `appian-connector-val-testConnectors`, `appian-connector-master-testConnectors`.
- AWS CLI profiles: `bigmac-dev` (master), `bigmac-val` (val), `bigmac-prod` (production).
- `testConnectors` is scheduled via EventBridge every minute; disable the EventBridge rule to stop scheduled runs (not the Lambda itself).
- `testConnectors` emits `{connectorName}_failures` and `{connectorName}_task_failures` in namespace `appian-connector-{stage}` and restarts connectors that are not RUNNING, except Oracle auth or account-lock traces. It cannot push new credentials. CloudWatch alarms currently watch `source.jdbc.appian-dbo-1_failures` and `source.jdbc.appian-dbo-1_task_failures`, which do not match the live connector `source.jdbc.appian-connector-dbo-1`.
- `testConnectors` reads `tasks[].trace`. `ORA-01017`, `ORA-28000`, or `account locked` emits `{connectorName}_oracle_auth_failures` 1 and `{connectorName}_oracle_errors` 1 and does not restart the task. Any other `ORA-` code emits auth 0 and oracle 1 and keeps the existing restart rule. No Oracle trace emits 0 and 0.
- The connector stack alarms only on `{connectorName}_oracle_auth_failures` (Sum >= 1, period 60 seconds, evaluation 1, missing data `notBreaching`) to `Alerts-appian-alerts-{stage}`. There is no alarm on `{connectorName}_oracle_errors`.
- `configureConnectors` reads connector status once after the config PUT. An auth or lock trace throws and does not restart. It does not poll, and it does not change `appian/{stage}/dbInfo`.
- Email subscriptions on `Alerts-appian-alerts-{stage}` are manual (`aws sns subscribe --protocol email`) and must be confirmed. Addresses are not committed.
- The JDBC source `source.jdbc.appian-connector-dbo-1` publishes to Kafka topic `aws.appian.cmcs.MCP_SPA_PCKG` (`timestamp+incrementing`, 5-minute poll).
- Yarn workspaces are `src/libs`, `src/services/*`, and `infra` (not `src/*` or `infra/*`).
- README documentation links point to the GitHub Wiki. Unreleased planning specs live under `docs/`.
- The production deploy workflow publishes the alerts stack and the connector stack only.
