# pw-rotation service

Automated DB password rotation for the Appian connector.

## What

When the `appian/{stage}/dbInfo` secret is changed in AWS Secrets Manager
(whether edited manually in the AWS console, updated via CLI, or rotated by
another system), this service:

1. Detects the change via an EventBridge rule on CloudTrail.
2. Reads the new secret value.
3. Pushes the new credentials into the `appian-connector-{stage}-configureConnectors`
  Lambda's environment variables.
4. Invokes `configureConnectors` to re-configure Kafka Connect with the new
  credentials.
5. Verifies the Kafka Connect JDBC source connector reaches `RUNNING` with a
  healthy task.
6. Emails a configurable list of recipients with either a success notice or a
  failure-with-remediation report.

Recipients are stored in SSM Parameter Store and read at runtime, so the list
can be changed without redeploying.

## Why

The DB password lives in three places:


| Location                                                            | How it's set                                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Secrets Manager (`appian/{stage}/dbInfo`)                           | Source of truth — edited by a human or by a rotation system                                  |
| `configureConnectors` Lambda env var (`legacydbPassword`)           | Read from the secret at CDK synth time; baked into the function configuration on each deploy |
| Kafka Connect connector config (REST API on the ECS Fargate worker) | Written by `configureConnectors` when it is invoked                                          |


Before this service, changing the secret value did not propagate to the Lambda
env var or to Kafka Connect — both still ran with the old password until the
next full CDK deploy. The connector would start failing with Oracle
`ORA-01017: invalid username/password` until someone manually re-ran
`configureConnectors`, or re-deployed.

This service closes that gap so a secret change automatically reconfigures the
running system, verifies it, and tells operators whether it worked.

## How it operates

```
  AWS Console / CLI                  AWS Secrets Manager
        │                                    │
        │  PutSecretValue / UpdateSecret     │
        └─────────────►──────────────────────┘
                                             │
                                             ▼
                                       CloudTrail
                                             │
                                             ▼
                                    EventBridge rule
                                  (matches dbInfo secret)
                                             │
                                             ▼
              ┌───────── appian-pw-rotation-{stage}-rotateDbPassword ────────────┐
              │                                                                 │
              │  1. parseRotationEvent     - validates the EventBridge payload  │
              │  2. readDbInfoSecret       - GetSecretValue                     │
              │  3. updateConfigureConnectorsEnv                                │
              │       - merges new password into existing env vars              │
              │       - UpdateFunctionConfiguration                             │
              │       - polls LastUpdateStatus until Successful                 │
              │  4. invokeConfigureConnectors                                   │
              │       - Lambda Invoke RequestResponse                           │
              │       - pushes new credentials into Kafka Connect REST          │
              │  5. findKafkaConnectWorkerIp + verifyConnectorRunning           │
              │       - polls /connectors/{name}/status over private VPC HTTP   │
              │       - returns running / failed (with trace) / timeout / 404   │
              │  6. loadRecipients (from SSM)                                   │
              │  7. sendRotationNotification (SES)                              │
              │                                                                 │
              └─────────────────────────────────────────────────────────────────┘
```

Each step has its own module under `libs/` and a dedicated test file under
`tests/`. The handler is `handlers/rotateDbPassword.ts`.

### Failure handling

Each phase has an associated remediation plan. On any failure, the rotation
Lambda assembles a phase-aware email that includes:

- The exact phase that failed (`read_secret`, `update_lambda_env`,
`invoke_configure_connectors`, `verify_connector`, etc.).
- The error message.
- A diagnosis summary.
- Numbered remediation steps tailored to the failure.

The verifier specifically recognizes several Oracle/JDBC errors and emits
targeted guidance:

- `ORA-01017` (invalid username/password) — most common after a manual rotation
with the wrong password.
- `ORA-12541` / `TNS:no listener` — host/port wrong, or SG egress blocked.
- `ORA-12514` — service name mismatch.
- `UnknownHostException` — DNS misconfiguration in the VPC.
- Generic socket/IO errors — VPC routing or NACL issues.

If none of those patterns match, the email includes the full status response
and trace excerpt for manual diagnosis.

### Configuration sources


| Source                                                 | What lives there                               | Changed by                                 |
| ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------ |
| Secrets Manager `appian/{stage}/dbInfo`                | DB credentials (the thing being rotated)       | Operators (manual) or rotation systems     |
| SSM Parameter `/appian/{stage}/pw-rotation/recipients` | Comma-separated email list                     | **Operators at runtime, no redeploy**      |
| Lambda env var `NOTIFICATION_SENDER`                   | From-address (must be a verified SES identity) | Redeploy with `PW_ROTATION_SENDER` env var |
| Lambda env var `CONNECTOR_NAME`                        | Connector name to verify                       | Redeploy                                   |


## Adding (or changing) email recipients

The recipient list is intentionally stored outside of code so that adding or
removing someone does **not** require a code change, PR, or redeploy.

### Console steps

1. Open AWS Systems Manager → Parameter Store.
2. Find `/appian/{stage}/pw-rotation/recipients` (one parameter per stage:
  `master`, `val`, `production`).
3. Click **Edit**.
4. Update the value. The format is a comma-, semicolon-, or newline-separated
  list of email addresses:
5. Click **Save changes**.

The next time the rotation Lambda runs (i.e., the next time the secret is
changed), it reads the updated parameter and emails the new list. There is no
deploy, no rebuild, no restart.

### CLI alternative

```bash
aws ssm put-parameter \
  --name "/appian/master/pw-rotation/recipients" \
  --type String \
  --overwrite \
  --value "alice@example.gov,bob@example.gov,oncall-pager@example.gov"
```

### Validation rules

The parameter is validated on each rotation run:

- The list must be non-empty after trimming whitespace.
- Each entry must look like an email address (`local@domain.tld`).
- Duplicates are de-duplicated automatically.
- Empty entries are ignored.

If validation fails, the rotation will still run, but the notification step
itself will fail and be logged. **Update the parameter as soon as possible** if
you receive a "rotation succeeded but notification failed" alarm on the Lambda.

### Recommended setup

- Use a shared distribution list address (e.g. `appian-ops@example.gov`) as
the primary recipient so membership changes do not require parameter edits.
- Add an on-call pager address if your pager system accepts inbound email.

## Costs

The rotation system is event-driven; it is essentially idle until a secret
change occurs. Estimated additional cost over the existing connector:


| Resource            | Cost driver                                            | Estimate       |
| ------------------- | ------------------------------------------------------ | -------------- |
| Lambda invocations  | Only runs on secret change (typically <1 / month)      | <$0.01 / month |
| Lambda duration     | 60-120s per run, 512 MB                                | <$0.01 / month |
| CloudWatch Logs     | 30-day retention, kilobyte-scale per run               | <$0.05 / month |
| EventBridge rule    | First million events / month free                      | $0             |
| SSM Parameter Store | Standard tier, single parameter                        | $0             |
| SES outbound email  | Bundled with most AWS accounts; $0.10 per 1,000 emails | <$0.01 / month |
| CloudTrail          | Already enabled for the account; no additional cost    | $0             |


Realistic monthly addition: **well under $1 per stage**, dominated by Lambda
warm-time and Logs retention.

## Risks and operational considerations

### What this service does *not* do

- It does **not** read the password and validate it against Oracle directly.
It relies on the Kafka Connect JDBC connector's own connection attempt to
detect a bad password. If the new password is wrong, the connector will fail
with `ORA-01017` and the rotation Lambda will report failure with that
diagnosis.
- It does **not** rotate the DB user's password on the Oracle side. That is
outside the scope of this service. You are responsible for ensuring the
password saved to Secrets Manager matches what was set on the DB.
- It does **not** roll back the Lambda env var on failure. After a failure,
the Lambda env var contains the new (likely-bad) password. Re-saving the
correct secret value re-triggers the rotation.
- It does **not** include a circuit breaker for rapid-fire secret changes.
If the secret is updated multiple times in quick succession, multiple
rotation invocations will run concurrently. The last one to finish wins.
For typical rotation cadences this is not an issue.

### Risks


| Risk                                                                   | Likelihood | Mitigation                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator saves a wrong password to the secret                          | Medium     | Rotation Lambda detects `ORA-01017`, emails operators with the specific error and remediation. Resave the correct value to retry.                                                                                                                                                                             |
| Rotation Lambda cannot reach the Kafka Connect REST API (VPC/SG drift) | Low        | The Lambda shares the same SG as `configureConnectors`; if `configureConnectors` works, the rotation Lambda works. Monitored by failure email.                                                                                                                                                                |
| SES sender identity not verified or in sandbox                         | Low        | Pre-deploy step: verify the sender identity in SES. Failed notifications log to CloudWatch but do not retry.                                                                                                                                                                                                  |
| The recipients SSM parameter is deleted or set to an empty value       | Low        | Rotation succeeds on AWS side; notification step logs an error. Existing CloudWatch alarms on the rotation Lambda's error metric will surface this.                                                                                                                                                           |
| Concurrent secret updates produce overlapping Lambda invocations       | Low        | Idempotent by design — the merge always writes the latest secret value. Worst case the last finisher wins.                                                                                                                                                                                                    |
| Rotation Lambda's role is too permissive                               | N/A        | The role is scoped: `secretsmanager:GetSecretValue` only on the dbInfo secret; `lambda:Update/Invoke` only on `configureConnectors`; `ses:SendEmail` only with the configured sender address; `ssm:GetParameter` only on the recipients parameter. ECS read-only is wildcard because `ListTasks` requires it. |
| Kafka Connect task takes longer than 2 minutes to come back to RUNNING | Low        | Verifier default timeout is 2 minutes. If the cluster is under load, the verifier returns `timeout` and emails operators with a "watch the connector manually" remediation step. Raise `timeoutMs` in `connector-verifier.ts` if this becomes routine.                                                        |


### Things to monitor

- The rotation Lambda's CloudWatch error count metric (already covered by the
Lambda runtime defaults).
- The connector's existing `*_failures` and `*_task_failures` CloudWatch
metrics — these will spike if the rotation pushed a bad password.
- The Kafka Connect ECS service task health — the rotation Lambda relies on
at least one task being in `RUNNING` to discover the REST endpoint.

### Opt-in deployment

The rotation stack is **opt-in**. It is only synthesized when the
`PW_ROTATION_SENDER` env var is set during CDK synth, so this service does not
affect existing stacks until you explicitly deploy it.

```bash
PW_ROTATION_SENDER="noreply-BIGMAC@cms.hhs.gov" \
PW_ROTATION_INITIAL_RECIPIENTS="benjamin.paige@cms.hhs.gov" \
npx cdk deploy appian-pw-rotation-master
```

Once deployed, the SSM parameter is created with `PW_ROTATION_INITIAL_RECIPIENTS`
as its initial value. From that point forward, change recipients via the
console or CLI as described above.

## Testing

Comprehensive unit + integration tests live in `tests/`:

```bash
npx vitest run --config ./src/tests/vitest.config.ts src/services/pw-rotation
```

Coverage targets:

- `libs/`: 90%+ statement coverage
- `handlers/`: 80%+ statement coverage

Tests use `aws-sdk-client-mock` for all AWS calls and inject
`verifyConnectorRunning` into the handler for clean isolation from real HTTP
traffic.