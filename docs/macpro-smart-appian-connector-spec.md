# MACPro → SMART Appian Connector (BigMAC)

**Status:** Live on master (dev) since 2026-10-27; cut over to the `MACPROTEST1` schema on master 2026-10-28; val/production pending view/grant/network confirmation (living document)  
**Jira:** [OY2-41661](https://jiraent.cms.gov/browse/OY2-41661) — MACPro → SMART Integration: BigMAC Appian Connector – New Oracle Table View Task  
**LOE context:** [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437)  
**Confluence (same living doc):** [MACPro → SMART Appian Connector (BigMAC)](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440)
This page is the **BigMAC / Appian connector** living overview for the MACPro → SMART unidirectional integration. It is not the SMART business scope and not the Database DDL design — those live elsewhere and are linked below.

---

## 1. Purpose

Add a **second** JDBC source on `macpro-appian-connector` that polls Oracle aggregated view **`MCP_SMART_INTG_AGGRTN_VW`** and publishes **one full-row change event per change** to a **new** Kafka topic on BigMAC for MuleSoft → SMART.

Do **not** reuse `aws.appian.cmcs.MCP_SPA_PCKG` (SEA Tool Compare / existing consumers; different contract). Do **not** use topic compaction for this feed — consumers must see every event in order.

**Deviation from earlier draft:** the flat view `MCP_SMART_INTEGRATION_VW` is no longer the connector source. BigMAC polls the aggregated view `MCP_SMART_INTG_AGGRTN_VW` instead.

---

## 2. Proposed connection (already documented)

The proposed **source-side connection** approach is published here:

- **[Database Approach (For MACPro)](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640)** — authoritative upstream design:
  1. Flat relational view at **SPA + RU** grain
  2. Reliable **change timestamp** per publishable change for near-real-time CDC
  3. Second aggregation so BigMAC publishes closer to **one logical package/update payload** (RU/SRT grouped), aggregation near the database — not Kafka/KSQL joins
  4. BigMAC CDC publishes **every change event** (not a compacted latest-only history)
  5. Migrated active SPAs must still receive updates after cutover
     Business events / what SMART receives:
- **[Proposed Scope & Assumptions for MACPro → SMART Integration](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1463687348)**
- **[Data Type values: MACPro→SMART Field Mapping](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1504378096)** — SMART payload mapping (includes `RU_JSON` / `REVIEWER_JSON` CLOBs); must be updated to match `MCP_SMART_INTG_AGGRTN_VW` column list
- **[LOE & PI Planning Worksheet](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1471316917)**
- **[MACPro System to SMART Integration Strategy](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1435318902)**
  Topic compaction guidance (for other BigMAC topics; **not used for this SMART feed**):
- **[BigMac - Kafka Topic Compaction](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1191412622)** — reference only; this topic uses `cleanup.policy=delete`
  Existing Appian connector (today):
- **[MACPro Appian Connector runbook](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947)** — `source.jdbc.appian-connector-dbo-1` → `aws.appian.cmcs.MCP_SPA_PCKG`, poll 5 min, `timestamp+incrementing`
  View validation:
- **[OY2-42370](https://jiraent.cms.gov/browse/OY2-42370)** — MACPro to SMART Integration View - Dev1 Validation

---

## 3. How BigMAC will publish (connector pattern)

Copy the existing Confluent JDBC source pattern in this repo:
| Setting | Current / proposed |
| --- | --- |
| Connector class | `io.confluent.connect.jdbc.JdbcSourceConnector` |
| Mode | `timestamp+incrementing` |
| Poll | Default **5 minutes** (`300000` ms) — confirm lag with SMART |
| Source | `${legacyschema}.MCP_SMART_INTG_AGGRTN_VW` — same Secrets Manager `appian/{stage}/dbInfo` and connector read-only login (`user` field) as the existing Appian connector |
| Query | Frozen custom `SELECT` (not `SELECT *`); `CAST(PCKG_ID AS NUMERIC(8,0))`; CLOB columns selected natively (kafka-connect-jdbc maps CLOB to a full Connect string; `DBMS_LOB.SUBSTR` cannot exceed 4000 chars on this DB and errors instead of truncating) |
| Value format | JSON **with embedded Connect schema** (no Schema Registry) |
| Semantics | Each message = **one full row for one change event** (not field diffs; not compacted latest-only) |
| Topic | `aws.appian.cmcs.MCP_SMART_INTG_AGGRTN_VW` |
| Kafka key | **none** (same as `MCP_SPA_PCKG`; `SPA_ID` is stable across package versions, `SPA_PCKG_ID` changes when a new package is created) |
| Watermark | `timestamp.column.name=REPLICA_TIMESTAMP`, `incrementing.column.name=PCKG_ID` (assumes one aggregated row per `PCKG_ID`) |
| Retention | `cleanup.policy=delete`; mirror existing topic: 1 partition, RF 3; retention period **TBD** (existing `MCP_SPA_PCKG` uses `retention.ms=-1`) |

Hard deletes are invisible to JDBC polling unless soft-delete / parent republish is designed into the source.

**Access gate (cleared for master, 2026-10-27; superseded 2026-10-28):** The view was initially only on Dev1, so master was first repointed to Dev1 via a new stage secret `appian/master/dbInfo`. On 2026-10-28 the business directed master to the `MACPROTEST1` schema instead: bigmac-dev's `appian/default/dbInfo` and `appian/master/dbInfo` were updated to the MACPROTEST1 values (same connector read-only login, used for both `MCP_SPA_PCKG` and `MCP_SMART_INTG_AGGRTN_VW`), master was redeployed, and both connectors were restarted with unchanged configuration. SELECT on both objects, all 21 view columns, and `PCKG_ID` uniqueness were verified directly against `MACPROTEST1` before the switch. Both Kafka topics were deleted and recreated with identical config and both connectors' JDBC offsets were reset (tombstones on the Connect offsets topic; the Confluent 6.0.9 worker has no REST offsets API), producing a verified clean snapshot of 8,165 `MCP_SPA_PCKG` rows and 3,577 `MCP_SMART_INTG_AGGRTN_VW` rows with no duplicate `PCKG_ID`s. Stage-to-schema mapping going forward: bigmac-dev = `MACPROTEST1`, bigmac-val = `MACPROVAL0`, bigmac-prod = `MACPROP`. Val/production are **not** cleared: the view, grant, and network path must be confirmed per stage before this connector config is deployed there.

---

## 4. What we need from Database (minimum to start)

- **Object name (confirmed for connector):** aggregated view `MCP_SMART_INTG_AGGRTN_VW` (not the flat `MCP_SMART_INTEGRATION_VW`)
- Schema: same `legacyschema` / same DB as existing connector (`appian/{stage}/dbInfo`)
- **Columns verified from `ALL_TAB_COLUMNS` on Dev1 (21), re-verified on `MACPROTEST1` 2026-10-28:** `PCKG_ID`, `REPLICA_TIMESTAMP`, `SPA_ID`, `SPA_PCKG_ID`, `STATE_CD`, `PGM_CD`, `EXEC_SUMMARY`, `AUTHRTY_CD`, `SBMSSN_DATE`, `CRNT_STUS`, `PKG_SUB_STUS`, `CRNT_STATE`, `PRRTY_CD`, `FRST_FED_FY`, `FRST_FED_FY_AMNT`, `SCND_FED_FY`, `SCND_FED_FY_AMNT`, `RSPNS_TS`, `RQST_TS`, `RU_JSON` (CLOB), `REVIEWER_JSON` (CLOB) — all 21 are in the connector query
- Proof `REPLICA_TIMESTAMP` advances on every publishable change; `PCKG_ID` unique and non-null on the aggregated grain (verified on Dev1: unique and non-null on all rows)
- CLOBs delivered natively at full length (observed maxima ~14.6k / ~7.8k chars; largest message ~19KB, well under the topic's ~1MB `max.message.bytes`, which needs no increase)
- Official-submission filter; delete/assignment-removal representation
- SELECT grant for connector read-only login on this view in val/prod (and master connector DB)
- Written schema + one example row (contract for MuleSoft even without a registry)

### Open questions (tracking)

1. Val/production: when will `MCP_SMART_INTG_AGGRTN_VW` exist there with SELECT for the read-only login, and is the network path in place? (Master/Dev1 resolved 2026-10-27.)
2. Poll interval preference vs 5 minutes?
3. Retention: topic mirrors `MCP_SPA_PCKG` today (`cleanup.policy=delete`, `retention.ms=-1`) — confirm that is acceptable for SMART or set a period.

---

## 5. BigMAC work (live on master since 2026-10-27; not yet in val/production)

From [OY2-41661](https://jiraent.cms.gov/browse/OY2-41661) / [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437) LOE:

- New topic `aws.appian.cmcs.MCP_SMART_INTG_AGGRTN_VW` with `cleanup.policy=delete` (exists on master MSK: 1 partition, RF 3, mirroring `MCP_SPA_PCKG`)
- Second Appian JDBC source/query + `REPLICA_TIMESTAMP` / `PCKG_ID` cursor; **no** message key
- MuleSoft consume connection details (topic, ACLs/auth, consumer group) — not MuleSoft transforms
- OneMAC/Mako topic registration (connection mapping only), if required
- Alarms/health for the new connector (via `connector-names.json` on promotion); password rotation must cover all active connectors
- Do not change `MCP_SPA_PCKG` contract for Compare

**Live on master today:** `smartIntegrationConnector` / `smartIntegrationQuery` in `src/services/connector/libs/` are in the deployed `connectors` list and `connector-names.json` with `tasks.max: 1`, deployed to master and validated end-to-end (initial snapshot published in full; both connectors RUNNING with clean health metrics and alarms). Since 2026-10-28 both master connectors read the `MACPROTEST1` schema; see the access-gate note in section 3 for the cutover record.

**Not yet in val/production:** the same code will attempt this connector in those stages on release. Do not release until the view, SELECT grant, topic, and network path are confirmed there.

---

## 6. References

| Doc                                     | Link                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- |
| Jira story                              | https://jiraent.cms.gov/browse/OY2-41661                              |
| Jira LOE ticket                         | https://jiraent.cms.gov/browse/OY2-41437                              |
| View validation                         | https://jiraent.cms.gov/browse/OY2-42370                              |
| This page on Confluence                 | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440 |
| Database Approach (proposed connection) | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640 |
| Field mapping                           | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1504378096 |
| Proposed Scope & Assumptions            | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1463687348 |
| LOE worksheet                           | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1471316917 |
| Kafka Topic Compaction (not used here)  | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1191412622 |
| Appian connector runbook                | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947 |
| Kafka Data Flow                         | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1163265150 |
| Repo spec (this file)                   | `docs/macpro-smart-appian-connector-spec.md`                          |
