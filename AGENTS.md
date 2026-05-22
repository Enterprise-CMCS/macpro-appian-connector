## Learned User Preferences

- Prefer simple, flat CLI scripts over abstractions (avoid jq, temp files, and case switches when a direct approach works).
- Prefer direct Lambda env update over CDK deploy for emergency password rotation.

## Learned Workspace Facts

- Connector DB credentials live in AWS Secrets Manager at `appian/{stage}/dbInfo` (JSON `password` field), not SSM.
- `configureConnectors` reads `legacydbPassword` from Lambda environment variables (set at CDK synth/deploy), not at runtime from Secrets Manager.
- Password rotation: update `legacydbPassword` on `configureConnectors`, then invoke `appian-connector-{stage}-configureConnectors`; leave ECS Kafka Connect running.
- Lambda names: `appian-connector-val-configureConnectors`, `appian-connector-production-configureConnectors`, `appian-connector-val-testConnectors`, `appian-connector-production-testConnectors`.
- AWS CLI profiles: `bigmac-val` (val), `bigmac-prod` (production).
- `testConnectors` is scheduled via EventBridge every minute; disable the EventBridge rule to stop scheduled runs (not the Lambda itself).
- `testConnectors` checks connector health only; it cannot push new credentials — `configureConnectors` is required for password rotation.
- Yarn workspaces are `src/libs`, `src/services/*`, and `infra` (not `src/*` or `infra/*`).
- In-repo `docs/` was removed; README documentation links point to the GitHub Wiki.
