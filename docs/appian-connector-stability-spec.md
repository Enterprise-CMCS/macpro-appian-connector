# Appian Connector Stability and Alerting

**Status:** Implemented on master; deploy and rollout per [appian-connector-stability-plan.md](appian-connector-stability-plan.md) Tasks 13–18
**Related:** [Oracle health check spec](appian-connector-oracle-health-spec.md) (implemented), [MACPro → SMART connector spec](macpro-smart-appian-connector-spec.md) (the second JDBC source will inherit everything here)
**Epic for generated tickets:** [OY2-29580 BigMAC Health](https://jiraent.cms.gov/browse/OY2-29580)

The goal is that any connection problem with an Appian JDBC connector reaches a person quickly. Every stage sends email (and the Slack channel address already subscribed on master). Val and production also open, or comment on, a Jira ticket.

This connector carries very little data. Days without new rows are normal. Nothing in this design alarms on missing data in the Kafka topic. The heartbeat alarm below watches the health check's own metric, which is published every minute whether or not rows move.

---

## 1. What is broken today

Checked against the live accounts on 14 October 2026.

| Gap | Effect |
| --- | --- |
| `JdbcConnectorAlarm` and `JdbcTaskAlarm` watch `source.jdbc.appian-dbo-1_*`. The connector is `source.jdbc.appian-connector-dbo-1`. | Both alarms sit in `INSUFFICIENT_DATA` and can never fire. Only the Oracle auth alarm works. |
| The `testConnectors` schedule rule is disabled by hand in val and production. | Val and production publish no connector or Oracle metrics at all. A connector in `FAILED` state with a live worker is silent. |
| The stack hard-codes the schedule rule `state: "ENABLED"`. | The template disagrees with val and production. Any change to that rule's properties would re-enable it on deploy. |
| No alarm watches the health check itself. | If the Lambda times out, crashes, or stops being scheduled, nobody hears about it. |
| The catch path in `testConnectors` emits `{name}_failures = 1` when the worker cannot be reached. | That metric is not watched (see the first row), so a worker that cannot be reached is silent. |
| `testConnector` HTTP calls have no timeout. `connectRestApiWithRetry` retries a response error forever. | A hung worker burns the full 300-second Lambda timeout every minute. |
| Alarms are written by hand for one connector name. | The second connector would have no alarms unless someone copies them. |
| JDBC alarms have no OK action. | No "recovered" email. |

---

## 2. Decisions

| Question | Decision |
| --- | --- |
| How tickets are created | A Lambda (`jiraNotifier`) calls the Jira Data Center REST API with PEIT's personal access token from Secrets Manager. |
| How the Lambda is triggered | EventBridge: CloudWatch `Alarm State Change` events for connection alarms, plus the existing ECS task-stopped rule. SNS email delivery is unchanged. |
| Stages that open tickets | Val and production. Master emails only. |
| Alarms that open tickets | Connection problems only: connector down, task down, Oracle bad login or locked account, restart cap reached, health check not running, health check erroring, ECS worker stopped. CPU, memory, and log ERROR/WARN counts email only. |
| Ticket lifecycle | One open ticket per stage and alarm. A repeat alarm or a recovery adds a comment. A person closes the ticket. |
| Val and production health check | Re-enabled with restarts for non-Oracle-auth failures, same as master, behind the guardrails in section 4. |

---

## 3. Phase 1: make the existing alarms real

No new services. Ships to all three stages.

### 3.1 One source of connector names

Add `src/services/connector/libs/connector-names.ts` exporting the connector names. `connectors.ts` uses it for `name`. `infra/lib/appian-connector-stack.ts` imports it and loops over it to build per-connector alarms. Adding the second connector to that list gives it the same alarms.

### 3.2 Alarm naming

Every alarm gets an explicit `alarmName`. Alarms that may open a Jira ticket start with `{servicePrefix}-conn-`. That prefix is the only thing the EventBridge rule in section 5 filters on.

`{short}` below is the connector name without the `source.jdbc.` prefix (`appian-connector-dbo-1` today).

### 3.3 Per-connector alarms (ticket-eligible)

All publish `AlarmActions` and `OKActions` to `Alerts-appian-alerts-{stage}`. Namespace `appian-connector-{stage}`. Period 60 seconds.

| Alarm name | Metric | Condition | Missing data |
| --- | --- | --- | --- |
| `{prefix}-conn-{short}-connector-down` | `{name}_failures` | Max >= 1 in 3 of 5 periods | `notBreaching` |
| `{prefix}-conn-{short}-task-down` | `{name}_task_failures` | Max >= 1 in 3 of 5 periods | `notBreaching` |
| `{prefix}-conn-{short}-oracle-auth` | `{name}_oracle_auth_failures` | Sum >= 1 in 1 of 1 | `notBreaching` |
| `{prefix}-conn-{short}-restart-capped` (Phase 2) | `{name}_restart_capped` | Max >= 1 in 1 of 1 | `notBreaching` |

Three of five minutes lets a single automatic restart recover before anyone is paged.

The old `JdbcConnectorAlarm`, `JdbcTaskAlarm`, and `JdbcOracleAuthAlarm` resources are removed. CloudFormation replaces them with the named alarms above.

### 3.4 Stage-level alarms

| Alarm name | Source | Condition | Ticket-eligible |
| --- | --- | --- | --- |
| `{prefix}-conn-health-check-missing` | `health_check_heartbeat` (new, `testConnectors` emits 1 on every run, in `try` and `catch`) | SampleCount < 1 over 5 periods of 60 seconds, missing data `breaching` | Yes |
| `{prefix}-conn-health-check-errors` | `AWS/Lambda` `Errors` for `{prefix}-testConnectors` | Sum >= 1 in 2 of 3 periods of 60 seconds | Yes |
| Existing CPU, memory, log ERROR, log WARN alarms | unchanged | unchanged | No, email only |

`health-check-missing` is created only when that stage's schedule is enabled (section 3.5). Otherwise it would alarm forever.

### 3.5 Schedule state from config

Add `healthCheckSchedule: "ENABLED" | "DISABLED"` to `EnvironmentConfig` in `infra/lib/environment-config.ts`.

| Stage | Phase 1 | Phase 2 |
| --- | --- | --- |
| master | `ENABLED` | `ENABLED` |
| val | `DISABLED` (matches live) | `ENABLED` |
| production | `DISABLED` (matches live) | `ENABLED` after val soaks |

The `TestConnectorsEventsRuleSchedule1` rule reads `state` from this value. Ephemeral branches fall back to master's config, as today.

### 3.6 HTTP limits

In `src/libs/connect-lib.ts`:

- Every request sets a 10-second timeout. On timeout the request is destroyed and the promise rejects.
- `connectRestApiWithRetry` stops after 5 attempts and rejects.

In `testConnectors`, the catch block logs `e.message` instead of `JSON.stringify(e)`, which prints `{}` for an `Error`.

---

## 4. Phase 2: re-enable the val and production health check

### 4.1 Fewer logins per restart

Add `"connection.attempts": 1` to the connector config in `connectors.ts`. The Confluent JDBC source defaults to 3 attempts per task start. One attempt means one failed login per restart when credentials are wrong. The first `ORA-01017` or `ORA-28000` trace already stops further restarts.

The new value reaches Kafka Connect only when `configureConnectors` PUTs the config. Invoke it once per stage, only after confirming that stage's `dbInfo` password is current. This is the same manual step as a password change.

### 4.2 Restart cap

Before restarting a connector, `testConnectors` reads the Sum of `{name}_restarts` over the last 60 minutes (`cloudwatch:GetMetricStatistics`).

- Below the cap: restart, then emit `{name}_restarts = 1` and `{name}_restart_capped = 0`.
- At or above the cap: skip the restart, then emit `{name}_restart_capped = 1`. That trips `{prefix}-conn-{short}-restart-capped`.

The cap is the Lambda environment variable `maxRestartsPerHour`, default `3`. If the metric read fails, the handler does not restart, and it treats the read failure as capped.

### 4.3 Rollout

1. Ask the database team for the `FAILED_LOGIN_ATTEMPTS` profile limit on the val and production connector logins. The cap of 3 per hour with 1 attempt each must stay well under it.
2. Set val to `ENABLED`, deploy, run `configureConnectors` once (section 4.1), and soak for 7 days.
3. Set production to `ENABLED` and repeat.
4. Update `AGENTS.md`. Replace the "val and production rules must stay disabled" fact with the guardrails above.

---

## 5. Phase 3: Jira tickets

### 5.1 Resources (val and production only)

Created when `EnvironmentConfig.jiraTickets` is `true`. Master is `false`.

| Resource | Detail |
| --- | --- |
| Lambda `{prefix}-jiraNotifier` | Node 24, same VPC, private subnets, and security group as the other connector Lambdas. The private subnets route through NAT, so `jiraent.cms.gov` is reachable. Timeout 30 seconds. Reserved concurrency 1, so two events for the same alarm cannot race and create two tickets. |
| EventBridge rule | `source: aws.cloudwatch`, `detail-type: CloudWatch Alarm State Change`, `detail.alarmName` prefix `{prefix}-conn-`, `detail.state.value` `ALARM` or `OK`. Target: the notifier. |
| Existing `ECSFailureEventRule` | Add the notifier as a second target next to SNS. |
| Async invoke config | Two retries, then the failed event goes to SQS queue `{prefix}-jiraNotifier-dlq`. |
| DLQ alarm | `ApproximateNumberOfMessagesVisible >= 1`, to SNS. Email only, so a broken notifier still reaches someone. |
| IAM | `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:{region}:{account}:secret:appian/{stage}/jira-*`, and `sqs:SendMessage` on the DLQ. |

### 5.2 Secret

Name: `appian/{stage}/jira`. JSON with exactly these keys:

```json
{"url":"https://jiraent.cms.gov","token":"<personal access token>"}
```

`url` is scheme and host only, with no trailing slash. The notifier still trims a trailing slash before building request paths. `token` is a Jira Data Center personal access token, sent as `Authorization: Bearer <token>`.

The notifier reads the secret at runtime and caches it for the life of the container. The token is never put in a Lambda environment variable or the CloudFormation template.

The secret was created on 14 October 2026 in master (`bigmac-dev`), val (`bigmac-val`), and production (`bigmac-prod`) with a one-off script that is not committed. Master has it too, so the notifier can be tested there later without another manual step. To rotate the token, write a file with the JSON above and run, per stage and profile:

```bash
aws secretsmanager put-secret-value --profile bigmac-val --region us-east-1 \
  --secret-id appian/val/jira --secret-string file://jira-secret.json
```

Delete the file afterward.

### 5.3 Ticket fields

The non-secret values live in one file, `src/services/connector/libs/jira-ticket-config.ts`.

| Field | Value |
| --- | --- |
| Project | `OY2` |
| Issue type | Bug (`10100`) |
| Summary | `[VAL] Appian connector: <title> (<alarm name>)` or `[PROD] ...` |
| Labels | `macpro_appian_connector`, plus `VAL` or `PROD` |
| Epic Link (`customfield_10100`) | `OY2-29580` |
| Components | `BigMAC` (id `67202`) and `MACPro Appian` (id `78303`). Sent by id, because an archived component named `MACPro/Appian` also exists. |
| Working Team (`customfield_26713`) | Platform Submission (option id `51914`). Required on OY2 Bugs. |
| Reporter | `{"name": "PEIT"}` |
| Assignee | `{"name": "PEIT"}` |
| Description | Alarm name, new state and reason, metric and threshold, time in UTC and Eastern, stage, a CloudWatch console link to the alarm, and the [connector runbook](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947). No password, connection string, or secret value. |

Titles by alarm:

| Alarm suffix | Title |
| --- | --- |
| `connector-down` | `<short> connector is not RUNNING` |
| `task-down` | `<short> task is not RUNNING` |
| `oracle-auth` | `<short> Oracle login rejected or account locked` |
| `restart-capped` | `<short> restart limit reached` |
| `health-check-missing` | `Health check has stopped reporting` |
| `health-check-errors` | `Health check Lambda is failing` |
| ECS task-stopped event | `Kafka Connect worker task stopped` |

### 5.4 Behavior

Find the open ticket:

```text
project = OY2 AND labels = macpro_appian_connector AND labels = <VAL|PROD> AND statusCategory != Done
```

That set is small, so the notifier fetches it (up to 100) and keeps the issue whose summary equals the expected summary exactly. It does not use `summary ~`, because Jira's text search tokenizes hyphenated alarm names unpredictably.

| Event | Open ticket exists | No open ticket |
| --- | --- | --- |
| Alarm to `ALARM` | Comment with the new reason and time | Create the ticket |
| Alarm to `OK` | Comment "Recovered at <time>". Leave it open. | Do nothing |
| ECS task stopped | Comment with the stopped reason | Create the ticket |

Any non-2xx response from Jira, or a 10-second timeout, makes the handler throw. Lambda retries twice, then the event lands in the DLQ and the DLQ alarm emails.

Two points to confirm during the first val test:

- OY2-29580 is in Done status. Jira Data Center normally accepts an Epic Link to a closed epic through the API, but if it rejects the create, reopen the epic or choose another one.
- Jira requires the "Modify Reporter" permission to set Reporter to someone other than the token owner. The token belongs to PEIT, so this should not apply.

---

## 6. Tests

`yarn test-ci` and `yarn --cwd infra test` exit 0.

Unit tests (vitest, `src/**`):

- `connect-lib`: a request that never responds rejects after the timeout. `connectRestApiWithRetry` gives up after 5 attempts.
- `testConnectors`: emits `health_check_heartbeat` on success and on a caught error. Below the cap it restarts and emits `_restarts = 1`. At the cap it does not restart and emits `_restart_capped = 1`. If the metric read fails, it does not restart.
- `jiraNotifier`:
  - An `ALARM` event with no open ticket creates one with every field in section 5.3.
  - An `ALARM` event with an open ticket comments and does not create one.
  - An `OK` event with an open ticket comments, and with none does nothing.
  - An ECS event creates the worker-stopped ticket.
  - An open ticket with a different summary is ignored.
  - A Jira 500 response makes the handler throw.
  - The request body never contains the token.

Infra tests (`infra/test`):

- Each name in `connector-names.ts` gets the `connector-down`, `task-down`, and `oracle-auth` alarms, with alarm and OK actions on the alerts topic.
- No alarm references `source.jdbc.appian-dbo-1`.
- No alarm watches `{name}_oracle_errors`.
- The schedule rule's state follows `healthCheckSchedule`, and `health-check-missing` exists only when it is `ENABLED`.
- With `jiraTickets` `false`, there is no notifier, rule, or DLQ. With `true`, all three exist, the EventBridge rule filters on the `{prefix}-conn-` prefix, and the IAM policy is scoped to `appian/{stage}/jira-*`.

Manual end-to-end in val after deploy:

1. `aws cloudwatch set-alarm-state --alarm-name appian-connector-val-conn-appian-connector-dbo-1-connector-down --state-value ALARM --state-reason "notifier test"`, using the `bigmac-val` profile. Expect an email and a new OY2 ticket with the fields in section 5.3.
2. Set the same alarm to `OK`. Expect a recovery email and a comment on that ticket.
3. Close the test ticket.

---

## 7. Later (not in this plan)

- Bake the JDBC plugin and Oracle driver into the ECR image. Today the worker downloads them from the internet on every boot, so an outage at Confluent Hub or Oracle blocks a restart.
- An ECS container health check against `localhost:8083`, so the existing "failed container health checks" pattern can match.
- Ticket creation on master, if wanted, by setting `jiraTickets: true` and adding a `DEV` label.

---

## 8. Done when

- On master, the named `-conn-` alarms are `OK` (not `INSUFFICIENT_DATA`), and no alarm references the old connector name.
- Stopping the `testConnectors` schedule on master trips `health-check-missing` within about 5 minutes.
- Val and production schedule rules are `ENABLED` in the template and live, with `connection.attempts` 1 and the restart cap in place. `AGENTS.md` is updated.
- The val manual test in section 6 creates one ticket with the required labels, epic, components, Working Team, reporter, and assignee, and the recovery adds a comment.
- `yarn test-ci` and `yarn --cwd infra test` exit 0.
