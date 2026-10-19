# MACPro → SMART Appian Connector (BigMAC)

**Status:** Planning (living document)  
**Jira:** [OY2-41661](https://jiraent.cms.gov/browse/OY2-41661) — MACPro → SMART Integration: BigMAC Appian Connector – New Oracle Table View Task  
**LOE context:** [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437)  
**Confluence (same living doc):** [MACPro → SMART Appian Connector (BigMAC)](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440)
This page is the **BigMAC / Appian connector** living overview for the MACPro → SMART unidirectional integration. It is not the SMART business scope and not the Database DDL design — those live elsewhere and are linked below.

---

## 1. Purpose

Add a **second** JDBC source on `macpro-appian-connector` that polls Oracle view **`MCP_SMART_INTEGRATION_VW`** and publishes **one full-row change event per change** to a **new** Kafka topic on BigMAC for MuleSoft → SMART.

Do **not** reuse `aws.appian.cmcs.MCP_SPA_PCKG` (SEA Tool Compare / existing consumers; different contract). Do **not** use topic compaction for this feed — consumers must see every event in order.

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
| Source | `${legacyschema}.MCP_SMART_INTEGRATION_VW` — same Secrets Manager `appian/{stage}/dbInfo` and connector read-only login (`user` field) as the existing Appian connector |
| Query | Frozen custom `SELECT` (not `SELECT *`) |
| Value format | JSON **with embedded Connect schema** (no Schema Registry) |
| Semantics | Each message = **one full row for one change event** (not field diffs; not compacted latest-only) |
| Topic | `aws.appian.cmcs.MCP_SMART_INTEGRATION_VW` |
| Kafka key | `SPA_PCKG_ID` — stable package business id for **partition ordering** (not compaction) |
| Retention | `cleanup.policy=delete`; retention period **TBD** |

Hard deletes are invisible to JDBC polling unless soft-delete / parent republish is designed into the source.

**Access gate:** The connector read-only login does not yet have SELECT on the view. Connector config may be staged in code but must **not** be deployed or started until the grant exists.

---

## 4. What we need from Database (minimum to start)

Draft is enough to scaffold; final val DDL can follow (~3–4 weeks Database LOE).

- **Object name (confirmed):** view `MCP_SMART_INTEGRATION_VW`; schema unchanged (`legacyschema` / same DB as existing connector)
- Final grain after aggregation (package-level payload vs SPA+RU rows) — align with [Database Approach](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640). Current view repeats rows per RU/assignment.
- Unique business key for Kafka message key — proposed: `SPA_PCKG_ID`
- Draft columns + Oracle types + nullability + multi-value encoding (JSON CLOB, etc.)
- **Visible columns so far** (from OY2-42370 screenshot; more may be off-screen): `PCKG_ID`, `SPA_ID`, `SPA_PCKG_ID`, `STATE_CD`, `PGM_CD`, `SBMSSN_DATE`, `PRGRM_NAME`, `CRNT_STUS`, `PKG_SUB_STUS`, `CRNT_STATE`, `RSPNS_TS`, `RQST_TS`, `CMPNNT_DESC`
- Incrementing unique ID + timestamp that advances on **every** publishable change (required for every-change capture; `PCKG_ID` is not unique per row)
- Official-submission vs draft filter; delete/assignment-removal representation
- Same DB / connector-login grants?; volume; val/prod dates — **SELECT grant not yet available**
- Written schema + one example row (contract for MuleSoft even without a registry)

### Details required to finish

Final DDL in val matching frozen SELECT; grants; proof timestamp moves on insert/update/assignment/status; index on `(timestamp, incrementing id)`; sample rows; Oracle type mappings; view refresh/lag if applicable; prod parity; topic creation ownership.

### Open questions (tracking)

1. Per-change unique ID and change timestamp columns on the view?
2. Whether intermediate changes between polls must be captured (current-state-only views collapse multiple changes into one poll)?
3. Topic retention period for `cleanup.policy=delete`?
4. When SELECT grant for the connector read-only login on `MCP_SMART_INTEGRATION_VW` will be in place?
5. Kafka key confirmed as `SPA_PCKG_ID`?
6. How removals/deletes appear?
7. Poll interval preference vs 5 minutes?
8. Full snapshot on first connector start vs watermark after go-live?

---

## 5. BigMAC work (planning — connector staged, not active)

From [OY2-41661](https://jiraent.cms.gov/browse/OY2-41661) / [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437) LOE:

- New topic with `cleanup.policy=delete` (retention TBD) + create-topics support if not already available
- Second Appian JDBC source/query + cursor columns + message key (`SPA_PCKG_ID` for ordering)
- MuleSoft consume connection details (topic, ACLs/auth, consumer group) — not MuleSoft transforms
- OneMAC/Mako topic registration (connection mapping only), if required
- Alarms/health for the new connector; password rotation must cover all active connectors
- Do not change `MCP_SPA_PCKG` contract for Compare
  **What we can do before the SELECT grant exists:** lock draft contract; agree topic/key/retention/poll; stage connector config and query in code **outside** the deployed connector list so nothing connects to the view; document sample payload.

**Blocked until grant:** deploy/activate connector, create val/prod topic for live publish, end-to-end validation.

---

## 6. References

| Doc                                     | Link                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- |
| Jira story                              | https://jiraent.cms.gov/browse/OY2-41661                              |
| Jira LOE ticket                         | https://jiraent.cms.gov/browse/OY2-41437                              |
| View validation                         | https://jiraent.cms.gov/browse/OY2-42370                              |
| This page on Confluence                 | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440 |
| Database Approach (proposed connection) | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640 |
| Proposed Scope & Assumptions            | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1463687348 |
| LOE worksheet                           | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1471316917 |
| Kafka Topic Compaction (not used here)  | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1191412622 |
| Appian connector runbook                | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947 |
| Kafka Data Flow                         | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1163265150 |
| Repo spec (this file)                   | `docs/macpro-smart-appian-connector-spec.md`                          |
