# Appian Connector Oracle Health Check

**Status:** Implemented  
**Jira:** [OY2-42136](https://jiraent.cms.gov/browse/OY2-42136) — Appian Connector Hardening  
**Related:** [MACPro → SMART Appian Connector spec](macpro-smart-appian-connector-spec.md) — the second JDBC source will use this same health check

Splunk already reads connector CloudWatch metrics and raises them through EOC. This work keeps that path. It makes the minute health check name Oracle logon and account-lock errors, it stops a bad password from being retried every minute, and it emails the existing alert topic as soon as the auth metric trips, ahead of the Splunk to EOC path.

SMS is not part of this work. Master and val are in the SNS SMS sandbox, the monthly SMS spend limit is $1, and neither account has an origination number. A phone subscription would not deliver until toll-free or 10DLC registration, which stays out of this story.

The master database user and password almost never change. Val and production users lock for several reasons. One `configureConnectors` invoke with the wrong password is enough to lock the user.

---

## 1. Purpose

Detect Oracle errors on the steady-state health check, with authentication and account lock called out separately, and publish them on the metric namespace Splunk already reads.

A rejected logon or a locked account must not be followed by another task restart.

---

## 2. What happens today

| Piece | Behavior |
| --- | --- |
| `testConnectors` | EventBridge every minute. Reads connector and task `state` only. Emits `{name}_failures` and `{name}_task_failures` (0 running, 1 otherwise). Restarts task 0 when state is not `RUNNING`. |
| `ConnectorStatus` | `src/types/index.ts` has no `trace` field. Kafka Connect returns `tasks[].trace` on a failed task. The handler never reads it. |
| Oracle codes in that trace | `ORA-01017` invalid username/password. `ORA-28000` account locked. Other `ORA-` codes (listener, service name, query failures) land in the same generic failure count. |
| `configureConnectors` | PUTs config from the Lambda environment (password captured at deploy), then always restarts. A wrong password locks val or production. The minute restart then tries that password again. |

---

## 3. Classification

Read `tasks[].trace` from `GET /connectors/{name}/status`. Match case-insensitively.

| Class | Match | Metric `{name}_oracle_auth_failures` | Metric `{name}_oracle_errors` | Restart task 0 |
| --- | --- | --- | --- | --- |
| Auth or lock | `ORA-01017`, `ORA-28000`, or the phrase `account locked` | 1 | 1 | No |
| Other Oracle | Any other `ORA-` code | 0 | 1 | Yes, same as today when state is not `RUNNING` |
| No Oracle trace | No match | 0 | 0 | Unchanged: restart when state is not `RUNNING` |

`{name}` is the connector name from `src/services/connector/libs/connectors.ts` (`source.jdbc.appian-connector-dbo-1` today).

Namespace stays the Lambda env `namespace`, which is `appian-connector-(stage)`. Existing `{name}_failures` and `{name}_task_failures` stay as they are, so current EOC alerts still fire.

Log one line per connector when an `ORA-` code is present. The line contains the connector name and the code. It does not contain the password or the connection URL.

Example:

```text
ORACLE_CONNECTOR_ERROR connector=source.jdbc.appian-connector-dbo-1 code=ORA-01017 class=auth
```

`class` is `auth` or `oracle`.

---

## 4. configureConnectors

After the config PUT, read connector status once. Do not poll in a loop.

When that status is auth or lock, the handler throws and does not call restart.

When the task has not failed yet, leave the explicit restart as it is today. The minute health check is the backstop, and it must not restart an auth or lock error on later runs.

Do not change how `legacydbPassword` is supplied. Do not rotate or rewrite the master password in this work.

---

## 5. Email notice

Alarm only on `{name}_oracle_auth_failures` (rejected logon and account lock). Do not alarm on `{name}_oracle_errors`. Listener and other Oracle codes stay on the existing Splunk path.

| Setting | Value |
| --- | --- |
| Metric | `{name}_oracle_auth_failures` in namespace `appian-connector-(stage)` |
| Condition | Sum >= 1 |
| Period | 60 seconds |
| Evaluation | 1 period |
| Missing data | `notBreaching`, so the alarm stays quiet until the health check has published the metric |
| Action | SNS topic `Alerts-appian-alerts-(stage)`, the same topic the connector stack already uses |

Define the alarm in `infra/lib/appian-connector-stack.ts` next to the existing JDBC alarms. Do not create a second topic.

Subscriptions stay manual, matching `src/services/alerts/README.md`: `aws sns subscribe --protocol email`, then the recipient confirms. Addresses are not committed. Several people means several subscriptions on that topic.

Master already has a confirmed email subscription on `Alerts-appian-alerts-master` (a `cmsgov.slack.com` address). Val's topic `Alerts-appian-alerts-val` has no subscriptions today. Val is not treated as delivered until it has at least one confirmed email subscription.

That topic also receives the existing log, CPU, memory, and ECS-stopped alarms. An Oracle auth email arrives in the same inbox. An Oracle-only mailbox would need a subscription filter or a separate topic, and that is not part of this story.

---

## 6. Read-only check of current stages

For master, val, and production, read `GET /connectors/source.jdbc.appian-connector-dbo-1/status` without invoking `configureConnectors` and without changing `appian/{stage}/dbInfo`.

Comment on OY2-42136, per stage: connector state, task state, and the `ORA-` code when one is present. No password. No connection string.

If master shows an Oracle error, fixing it is a database-side unlock or a corrected config. It is not another `configureConnectors` attempt.

---

## 7. Tests

`yarn test-ci` exits 0. Cases:

- Status body with `ORA-01017` sets auth metric 1, oracle metric 1, and does not restart.
- Status body with `ORA-28000` or `account locked` does the same.
- Status body with `ORA-12541` sets auth metric 0, oracle metric 1, and may restart.
- `RUNNING` and no trace sets both new metrics to 0 and does not restart.
- `configureConnectors`, given a stubbed auth-failure status after PUT, rejects and does not restart.
- An infra test asserts an alarm on `{name}_oracle_auth_failures` whose action is the existing alerts topic, and asserts there is no alarm on `{name}_oracle_errors`. `yarn --cwd infra test` exits 0.

---

## 8. Not in this work

SMS, origination-number registration, and phone-number subscriptions. A separate Oracle-only SNS topic. CloudWatch alarm-name alignment for the existing JDBC failure metrics, HTTP retry limits, Connect image or JDBC plugin upgrades, and the second SMART connector. Password-rotation behavior stays as it is.

---

## 9. Done when

- The minute health check classifies auth/lock separately from other `ORA-` codes and emits both metrics in the existing namespace.
- Auth and lock errors do not restart the task.
- `configureConnectors` does not restart after a status that is already an auth or lock failure.
- Master, val, and production traces are commented on OY2-42136.
- An alarm on `{name}_oracle_auth_failures` publishes to `Alerts-appian-alerts-(stage)`. There is no alarm on `{name}_oracle_errors`.
- Val has at least one confirmed email subscription on `Alerts-appian-alerts-val` before that alarm is treated as delivered.
- `yarn test-ci` and `yarn --cwd infra test` exit 0.
