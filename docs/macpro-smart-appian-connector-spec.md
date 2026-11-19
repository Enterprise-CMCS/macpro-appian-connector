# MACPro → SMART Appian Connector (BigMAC)

- **Status:** Live on master (dev) since 2026-10-27. Master reads the `MACPROTEST1` schema since 2026-10-28. Schema updated for [OY2-42881](https://jiraent.cms.gov/browse/OY2-42881) and the topic republished on 2026-11-10. Val/production are pending view, grant, and network confirmation. (Living document.)
- **Jira** — [OY2-41661](https://jiraent.cms.gov/browse/OY2-41661) — MACPro → SMART Integration: BigMAC Appian Connector – New Oracle Table View Task
- **Schema change** — [OY2-42881](https://jiraent.cms.gov/browse/OY2-42881) — SMART Integration Query
- **LOE context** — [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437)
- **Confluence (same living doc)** — [MACPro → SMART Appian Connector (BigMAC)](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440)

This page is the **BigMAC / Appian connector** living overview for the MACPro → SMART unidirectional integration. It is not the SMART business scope and not the Database DDL design — those live elsewhere and are linked below. Consumers (MuleSoft → SMART) should start with section 6, which describes every message on the topic.

---

## 1. Purpose

A **second** JDBC source on `macpro-appian-connector` polls the Oracle aggregated view **`MCP_SMART_INTG_AGGRTN_VW`** and publishes **one full-row change event per change** to its own Kafka topic on BigMAC for MuleSoft → SMART.

Do **not** reuse `aws.appian.cmcs.MCP_SPA_PCKG` (SEA Tool Compare and other existing consumers rely on a different contract). Do **not** compact this topic — consumers must see every event in order.

**Deviation from the earlier draft:** the flat view `MCP_SMART_INTEGRATION_VW` is no longer the connector source. BigMAC polls the aggregated view `MCP_SMART_INTG_AGGRTN_VW` instead.

---

## 2. Upstream design and related pages

The source-side connection approach is published here:

**[Database Approach (For MACPro)](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640)** — authoritative upstream design:

1. Flat relational view at **SPA + RU** grain
2. Reliable **change timestamp** per publishable change for near-real-time CDC
3. Second aggregation so BigMAC publishes closer to **one logical package/update payload** (RU/SRT grouped), aggregated near the database — not Kafka/KSQL joins
4. BigMAC CDC publishes **every change event** (not a compacted latest-only history)
5. Migrated active SPAs must still receive updates after cutover

Business events and what SMART receives:

- **[Proposed Scope & Assumptions for MACPro → SMART Integration](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1463687348)**
- **[Data Type values: MACPro→SMART Field Mapping](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1504378096)** — SMART payload mapping. Note: it lists `CNSLTN_DT` as DATE, but the view publishes it as text (see section 6).
- **[LOE & PI Planning Worksheet](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1471316917)**
- **[MACPro System to SMART Integration Strategy](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1435318902)**

Topic compaction guidance (for other BigMAC topics; **not used for this feed**):

- **[BigMac - Kafka Topic Compaction](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1191412622)** — reference only; this topic uses `cleanup.policy=delete`

Existing Appian connector:

- **[MACPro Appian Connector runbook](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947)** — `source.jdbc.appian-connector-dbo-1` → `aws.appian.cmcs.MCP_SPA_PCKG`, poll 5 min, `timestamp+incrementing`

View validation:

- **[OY2-42370](https://jiraent.cms.gov/browse/OY2-42370)** — MACPro to SMART Integration View - Dev1 Validation

---

## 3. How BigMAC publishes (connector configuration)

| Setting      | Value                                                                                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connector    | `source.jdbc.appian-connector-smart-1` (`io.confluent.connect.jdbc.JdbcSourceConnector`, 1 task)                                                                                                                                                                                                                                  |
| Mode         | `timestamp`                                                                                                                                                                                                                                                                                                                       |
| Watermark    | `timestamp.column.name=REPLICA_TIMESTAMP` only — the view no longer exposes a unique numeric incrementing id                                                                                                                                                                                                                      |
| Poll         | **5 minutes** (`300000` ms) — confirm lag with SMART                                                                                                                                                                                                                                                                              |
| Source       | `${legacyschema}.MCP_SMART_INTG_AGGRTN_VW` — same Secrets Manager `appian/{stage}/dbInfo` and connector read-only login as the existing Appian connector                                                                                                                                                                          |
| Query        | Frozen custom `SELECT` (not `SELECT *`) of all 20 view columns, including `CNSLTN_DT` and `SOURCE_SYSTEM` (OY2-42881). CLOB columns are selected natively; kafka-connect-jdbc maps CLOB to a full string. `DBMS_LOB.SUBSTR` must not be used: this database caps SQL strings at 4000 characters and errors instead of truncating. |
| Value format | JSON **with embedded Connect schema** (no Schema Registry)                                                                                                                                                                                                                                                                        |
| Semantics    | Each message = **one full row for one change event** (not field diffs; not compacted latest-only)                                                                                                                                                                                                                                 |
| Topic        | `aws.appian.cmcs.MCP_SMART_INTG_AGGRTN_VW`                                                                                                                                                                                                                                                                                        |
| Kafka key    | **none** (same as `MCP_SPA_PCKG`)                                                                                                                                                                                                                                                                                                 |
| Topic config | 1 partition, replication factor 3, `cleanup.policy=delete`, `retention.ms=-1`, `min.insync.replicas=2`                                                                                                                                                                                                                            |

Hard deletes are invisible to JDBC polling unless soft-delete or parent republish is designed into the source.

<!-- prettier-ignore -->
> [!WARNING]
> **Timestamp-only tracking can miss rows.** The view no longer has a unique incrementing column, so the connector tracks changes with `REPLICA_TIMESTAMP` alone. Each poll asks only for rows whose `REPLICA_TIMESTAMP` is later than the newest value already published. If a row is written or committed after a poll but carries a `REPLICA_TIMESTAMP` equal to or earlier than that value, the connector never publishes it, and nothing alerts on the gap. The values are coarse: the 3,605 rows share 753 distinct timestamps, 3,273 rows share their timestamp with at least one other row, and one timestamp covers 378 rows. To close the gap, the database needs to either guarantee that `REPLICA_TIMESTAMP` is always later than anything already committed, or add a unique, always-increasing column so the connector can go back to `timestamp+incrementing` mode. Until then, a full republish (as done on 2026-11-10) is the only way to recover a missed row.

### Environment history

- **2026-10-27** — First live on master, pointed at the Dev1 schema through stage secret `appian/master/dbInfo`.
- **2026-10-28** — Business directed master to `MACPROTEST1`. Both master Appian topics were recreated and both connectors' offsets reset, giving a clean snapshot.
- **2026-11-10 ([OY2-42881](https://jiraent.cms.gov/browse/OY2-42881))** — The view dropped `PCKG_ID`, `SPA_PCKG_ID`, and `AUTHRTY_CD` and added `CNSLTN_DT` and `SOURCE_SYSTEM`. The old query started failing with `ORA-00904: "PCKG_ID": invalid identifier`. The query was updated to the 20 current columns and the mode changed to `timestamp`. On master, only the SMART connector was stopped, its topic deleted and recreated with the same configuration, and its stored offsets cleared; the new query then republished a full snapshot of **3,605** messages, matching the 3,605 rows in the view. `MCP_SPA_PCKG` and its connector were not touched.

Stage-to-schema mapping: bigmac-dev = `MACPROTEST1`, bigmac-val = `MACPROVAL0`, bigmac-prod = `MACPROP`. Val and production are **not** cleared: the view, grant, and network path must be confirmed per stage before this connector is released there.

---

## 4. Database requirements and status

- **Object (confirmed):** aggregated view `MCP_SMART_INTG_AGGRTN_VW` (not the flat `MCP_SMART_INTEGRATION_VW`), same `legacyschema` and database as the existing connector
- **Columns verified from `ALL_TAB_COLUMNS` on `MACPROTEST1`, 2026-11-10 (20)** — `SPA_ID`, `STATE_CD`, `PGM_CD`, `EXEC_SUMMARY`, `CNSLTN_DT`, `SBMSSN_DATE`, `PRRTY_CD`, `FRST_FED_FY`, `FRST_FED_FY_AMNT`, `SCND_FED_FY`, `SCND_FED_FY_AMNT`, `CRNT_STUS`, `PKG_SUB_STUS`, `CRNT_STATE`, `RSPNS_TS`, `RQST_TS`, `SOURCE_SYSTEM`, `REPLICA_TIMESTAMP`, `RU_JSON` (CLOB), `REVIEWER_JSON` (CLOB). All 20 are in the connector query.
- `REPLICA_TIMESTAMP` must advance on every publishable change. No nulls observed. Many rows share a value, so it cannot also serve as a unique column; see the warning in section 3.
- CLOBs are delivered at full length. Observed maxima: `RU_JSON` 6,953 characters, `REVIEWER_JSON` 23,496 characters. The largest message is about 30 KB, well under the topic's ~1 MB limit.
- Still needed: official-submission filter; how deletes and assignment removals are represented; SELECT grant for the connector read-only login in val and production.

### Open questions

1. Val/production: when will `MCP_SMART_INTG_AGGRTN_VW` exist there with SELECT for the read-only login, and is the network path in place?
2. Poll interval preference vs 5 minutes?
3. Retention: the topic keeps messages forever (`retention.ms=-1`, same as `MCP_SPA_PCKG`). Confirm that is acceptable for SMART or set a period.
4. Timestamp-only tracking (warning in section 3): can the database guarantee a strictly later `REPLICA_TIMESTAMP` for every late commit, or add a unique incrementing column back to the view?

---

## 5. BigMAC work

From [OY2-41661](https://jiraent.cms.gov/browse/OY2-41661) / [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437) LOE:

- Topic `aws.appian.cmcs.MCP_SMART_INTG_AGGRTN_VW` with `cleanup.policy=delete` — exists on master
- Second Appian JDBC source/query with a `REPLICA_TIMESTAMP` cursor and **no** message key — live on master
- MuleSoft consume connection details (topic, ACLs/auth, consumer group) — not MuleSoft transforms
- OneMAC/Mako topic registration (connection mapping only), if required
- Alarms and health checks for the new connector — live on master (connector down, task down, Oracle auth, restart cap)
- Do not change the `MCP_SPA_PCKG` contract used by Compare

**Live on master:** the connector runs in the deployed connector list with health checks and alarms. The 2026-11-10 republish was verified end to end: row count matches the view, every message carries the 20-field schema, and both master connectors report RUNNING.

**Not yet in val/production:** the same code will attempt this connector in those stages on release. Do not release until the view, SELECT grant, topic, and network path are confirmed there.

---

## 6. Message schema (consumer contract)

Verified on 2026-11-10 against all 3,605 messages on the master topic, not just the view definition.

### Topic facts

| Property    | Value                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------- |
| Partitions  | 1 (total order by offset)                                                                 |
| Message key | none (always `null`)                                                                      |
| Value       | JSON object `{ "schema": ..., "payload": ... }` — Kafka Connect JSON with embedded schema |
| Retention   | kept forever, never compacted                                                             |
| One message | one full view row at the moment it changed                                                |
| Ordering    | `REPLICA_TIMESTAMP` never decreases from one offset to the next                           |

### Fields

All 20 fields are declared optional in the embedded schema, so any field can be `null`. "Nulls" is the count out of 3,605 messages on 2026-11-10.

| Field               | Connect type      | JSON value                     | Nulls | Notes                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------- | ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SPA_ID`            | string            | string or `null`               | 83    | Business identifier such as `MN-16-012`. Always either `null` or a non-empty string. Rows with `null` are published like every other row. Unique among non-null values in the snapshot.                                                                                                                                  |
| `STATE_CD`          | string            | string                         | 0     | Two-letter state or territory code.                                                                                                                                                                                                                                                                                      |
| `PGM_CD`            | string            | string                         | 0     | Only `MEDICAID` observed.                                                                                                                                                                                                                                                                                                |
| `EXEC_SUMMARY`      | string            | string                         | 0     | Free text.                                                                                                                                                                                                                                                                                                               |
| `CNSLTN_DT`         | string            | string or `null`               | 3,300 | Plain text, not JSON and not a date type. Always either `null` or a non-empty string. Usually one Oracle-style date `DD-MON-YY` (294 of 305 non-null values, for example `26-FEB-15`); 11 values are a comma-separated list of two or three such dates (for example `10-DEC-15,17-MAR-16`). Published exactly as stored. |
| `SBMSSN_DATE`       | Timestamp (int64) | epoch milliseconds             | 3     | Always midnight UTC; treat as a calendar date.                                                                                                                                                                                                                                                                           |
| `PRRTY_CD`          | string            | string                         | 2,980 | `P1`, `P2`, `P3`.                                                                                                                                                                                                                                                                                                        |
| `FRST_FED_FY`       | string            | string                         | 0     | Four-digit year as text, for example `"2026"`.                                                                                                                                                                                                                                                                           |
| `FRST_FED_FY_AMNT`  | double            | number                         | 0     | All observed values are whole numbers.                                                                                                                                                                                                                                                                                   |
| `SCND_FED_FY`       | string            | string                         | 0     | Four-digit year as text.                                                                                                                                                                                                                                                                                                 |
| `SCND_FED_FY_AMNT`  | double            | number                         | 0     | All observed values are whole numbers.                                                                                                                                                                                                                                                                                   |
| `CRNT_STUS`         | string            | string                         | 0     | Package status (values below).                                                                                                                                                                                                                                                                                           |
| `PKG_SUB_STUS`      | string            | string                         | 3,546 | `Pending Approval` or `Pending Concurrence`.                                                                                                                                                                                                                                                                             |
| `CRNT_STATE`        | string            | string                         | 0     | Workflow state name (values below).                                                                                                                                                                                                                                                                                      |
| `RSPNS_TS`          | Timestamp (int64) | epoch milliseconds             | 3,488 | RAI response received.                                                                                                                                                                                                                                                                                                   |
| `RQST_TS`           | Timestamp (int64) | epoch milliseconds             | 3,454 | RAI requested / received date.                                                                                                                                                                                                                                                                                           |
| `SOURCE_SYSTEM`     | string            | string                         | 0     | Only `MACPRO` observed.                                                                                                                                                                                                                                                                                                  |
| `REPLICA_TIMESTAMP` | Timestamp (int64) | epoch milliseconds             | 0     | Change timestamp the connector tracks.                                                                                                                                                                                                                                                                                   |
| `RU_JSON`           | string            | string containing a JSON array | 0     | Parse with `JSON.parse`; shape in `ReviewUnit` below.                                                                                                                                                                                                                                                                    |
| `REVIEWER_JSON`     | string            | string containing a JSON array | 0     | Parse with `JSON.parse`; shape in `Reviewer` below.                                                                                                                                                                                                                                                                      |

### Values seen in the data

New values can appear; consumers should not reject unknown ones.

- **`CRNT_STUS`** — `Approved`, `Closed`, `Closed-Approved`, `Submitted`, `Review`, `Withdrawn`, `RAI`, `Closed-Disapproved`, `Disapproved`, `Deleted`, `Revised`, `Returned`, `Clarification`
- **`CRNT_STATE`** — `ApprovePackage`, `CPOCAttachDisapprovalDocumentation`, `CPOCAttachDocumentation`, `CPOCClose`, `CPOCCloseDisapproval`, `ClarificationSPOC`, `ClosePackage`, `ClosePackageDisapprove`, `DeletedSPOC`, `PackageApproval`, `ReturnedSPOC`, `ReturnedSPOCEdit`, `Review`, `SERAI`, `SPOCAcknowledge`, `SPOCAcknowledgeDisapproval`, `SPOCRAI`, `SPOCRAIEdit`, `SPOCWithdrawRAI`, `SeniorReviewerReviewRAI`, `SrManagerReviewApproval`, `Submitted`, `Withdrawn`
- **Reviewer `role_name` (`role_id`):** State Point of Contact (SPOC) 4, State Editor (SE) 3, State Director (SDIR) 5, CMS Senior Reviewer (SRRVW) 12, CMS Point of Contact (CPOC) 6, CMS Submission Review Team Member (SRT) 7, CMS Package Approver (PA) 13, CMS Disapproval Coordinator (DC) 23, CMS Package Disapprover (PD) 15
- **Reviewer `rvw_dcsn`** — `Accepted Approval Letter and Agreed with CPOC's recommended approval disposition`, `Agreed`, `Pending`, `Disagreed`, `Meeting Requested`, `Bypassed`
- **Reviewer `sub_stus`** — `Pending Approval`, `Pending Concurrence`
- **RU `cmpnnt_authrty_cd`** — `ELG`, `HHP`, `ADMIN`

### TypeScript types

These types describe every message on the topic. They compile under `strict`, and all 3,605 messages — including 26,825 parsed RU entries and 16,535 parsed reviewer entries — were checked against them with no mismatches.

```typescript
/** One field descriptor inside the embedded Kafka Connect schema. */
export interface ConnectField {
  field: string;
  type: "string" | "int64" | "double";
  optional: boolean;
  /** Present on timestamp fields: "org.apache.kafka.connect.data.Timestamp". */
  name?: string;
  version?: number;
}

export interface ConnectStructSchema {
  type: "struct";
  optional: false;
  fields: ConnectField[];
}

/** Epoch milliseconds (Kafka Connect Timestamp logical type). */
export type EpochMillis = number;

/** Known values today; `(string & {})` keeps the type open to new values. */
export type CrntStus =
  | "Approved"
  | "Closed"
  | "Closed-Approved"
  | "Submitted"
  | "Review"
  | "Withdrawn"
  | "RAI"
  | "Closed-Disapproved"
  | "Disapproved"
  | "Deleted"
  | "Revised"
  | "Returned"
  | "Clarification"
  | (string & {});

export type PkgSubStus = "Pending Approval" | "Pending Concurrence" | (string & {});
export type PriorityCode = "P1" | "P2" | "P3" | (string & {});

/** The `payload` of every message: one row of MCP_SMART_INTG_AGGRTN_VW. */
export interface SmartIntegrationRow {
  /** Null on some rows; those rows are still published. */
  SPA_ID: string | null;
  STATE_CD: string | null;
  PGM_CD: string | null;
  EXEC_SUMMARY: string | null;
  /**
   * Plain text exactly as stored: one `DD-MON-YY` date ("26-FEB-15")
   * or a comma-separated list of them ("10-DEC-15,17-MAR-16").
   */
  CNSLTN_DT: string | null;
  SBMSSN_DATE: EpochMillis | null;
  PRRTY_CD: PriorityCode | null;
  /** Four-digit year as text, for example "2026". */
  FRST_FED_FY: string | null;
  FRST_FED_FY_AMNT: number | null;
  SCND_FED_FY: string | null;
  SCND_FED_FY_AMNT: number | null;
  CRNT_STUS: CrntStus | null;
  PKG_SUB_STUS: PkgSubStus | null;
  CRNT_STATE: string | null;
  RSPNS_TS: EpochMillis | null;
  RQST_TS: EpochMillis | null;
  SOURCE_SYSTEM: "MACPRO" | (string & {}) | null;
  REPLICA_TIMESTAMP: EpochMillis | null;
  /** JSON-encoded `ReviewUnit[]`; parse before use. */
  RU_JSON: string | null;
  /** JSON-encoded `Reviewer[]`; parse before use. */
  REVIEWER_JSON: string | null;
}

/** The full Kafka message value as read from the topic. */
export interface SmartIntegrationMessage {
  schema: ConnectStructSchema;
  payload: SmartIntegrationRow;
}

/** Entry of RU_JSON after JSON.parse. Key casing is exactly as published. */
export interface ReviewUnit {
  cmpnt_id: number;
  cmpnnt_desc: string;
  /** Local date-time without zone, for example "2019-01-01T00:00:00". */
  prpsd_efctv_dt: string | null;
  efctv_dt: string | null;
  cmpnnt_authrty_cd: "ELG" | "HHP" | "ADMIN" | (string & {}) | null;
  RU_rvwr_email: string | null;
}

/** Entry of REVIEWER_JSON after JSON.parse. Key casing is exactly as published. */
export interface Reviewer {
  frst_name: string;
  lst_name: string;
  Email: string;
  role_id: number;
  role_name: string;
  user_grp: string | null;
  user_div: string | null;
  sub_stus: PkgSubStus | null;
  rvw_dcsn: string | null;
}

/** A row with the two CLOB columns parsed into arrays. */
export interface ParsedSmartIntegrationRow extends Omit<SmartIntegrationRow, "RU_JSON" | "REVIEWER_JSON"> {
  reviewUnits: ReviewUnit[];
  reviewers: Reviewer[];
}

export function parseRow(row: SmartIntegrationRow): ParsedSmartIntegrationRow {
  const { RU_JSON, REVIEWER_JSON, ...rest } = row;
  return {
    ...rest,
    reviewUnits: RU_JSON ? (JSON.parse(RU_JSON) as ReviewUnit[]) : [],
    reviewers: REVIEWER_JSON ? (JSON.parse(REVIEWER_JSON) as Reviewer[]) : [],
  };
}
```

### How a consumer should treat the data

**Read the payload; the schema block is the same on every message.** Check `value.schema` once if you want to detect a contract change; otherwise use `value.payload`.

**Each message is a full snapshot of one row.** The connector republishes the whole row whenever `REPLICA_TIMESTAMP` moves forward. To keep the current state of a package, upsert by `SPA_ID` and keep the message with the highest `REPLICA_TIMESTAMP` (with one partition, the higher offset also wins).

**Every row is published, including rows without `SPA_ID`.** The topic has no message key, so the connector publishes every row with whatever values it contains. In the 2026-11-10 snapshot, 83 rows have `SPA_ID = null`. `SPA_ID` is always either `null` or a non-empty string, never an empty string; consumers decide how to handle the `null` rows.

**Start from the earliest offset.** The topic was recreated on 2026-11-10 for the OY2-42881 schema change. Offsets 0–3604 are a full snapshot of the view at that moment; later offsets are changes. A consumer group created before the recreate, or one using `auto.offset.reset=latest`, must be reset to the beginning. Any future contract change will be handled the same way and announced here.

**Timestamps.** The fields `SBMSSN_DATE`, `RSPNS_TS`, `RQST_TS`, and `REPLICA_TIMESTAMP` are epoch milliseconds. Oracle stores them without a time zone, and the connector writes the stored clock time as if it were UTC. Format them in UTC to get back the value MACPro shows; do not shift them to local time.

**`CNSLTN_DT` is text.** It is either `null` or a string, published exactly as stored. Most values hold one `DD-MON-YY` date; some hold a comma-separated list of dates. The connector does not split or convert it, so consumers parse it however they need.

**Fiscal years and amounts.** The fields `FRST_FED_FY` and `SCND_FED_FY` are strings. The amount fields are JSON numbers; every current value is a whole number.

**RU and reviewer lists are JSON strings.** Both `RU_JSON` and `REVIEWER_JSON` must be parsed; both were non-empty arrays in every message. Keep the key casing exactly as published (`RU_rvwr_email`, `Email`, everything else lower case). Dates inside them (`efctv_dt`, `prpsd_efctv_dt`) are ISO local date-times with no zone. About 29% of RU entries carry `3036-09-30T00:00:00`; it is published as stored, and consumers interpret it however they need.

**What the topic cannot tell you.** Hard deletes in Oracle never produce a message. A package that disappears from the view simply stops getting updates. `CRNT_STUS = Deleted` is the only deletion signal in the data today.

**Expect long quiet periods.** Little data and days without new messages are normal for this feed.

---

## 7. References

| Doc                                     | Link                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| Jira story                              | <https://jiraent.cms.gov/browse/OY2-41661>                              |
| Schema change (OY2-42881)               | <https://jiraent.cms.gov/browse/OY2-42881>                              |
| Jira LOE ticket                         | <https://jiraent.cms.gov/browse/OY2-41437>                              |
| View validation                         | <https://jiraent.cms.gov/browse/OY2-42370>                              |
| Database Approach (proposed connection) | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640> |
| Field mapping                           | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1504378096> |
| Proposed Scope & Assumptions            | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1463687348> |
| LOE worksheet                           | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1471316917> |
| Kafka Topic Compaction (not used here)  | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1191412622> |
| Appian connector runbook                | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947> |
| Database password rotation              | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1504366491> |
| Kafka Data Flow                         | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1163265150> |
| This page on Confluence                 | <https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440> |
