# MACPro → SMART Appian Connector (BigMAC)

**Status:** Planning (living document)  
**Jira:** [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437) — Determine BigMAC LOE for MACPRO–SMART Integration  
**Confluence (same living doc):** [MACPro → SMART Appian Connector (BigMAC)](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440)
This page is the **BigMAC / Appian connector** living overview for the MACPro → SMART unidirectional integration. It is not the SMART business scope and not the Database DDL design — those live elsewhere and are linked below.

---

## 1. Purpose

Add a **second** JDBC source on `macpro-appian-connector` that polls a **new** MACPro/Database integration-facing object (view/table after aggregation) and publishes **latest-state full-row** change events to a **new** Kafka topic on BigMAC for MuleSoft → SMART.
Do **not** reuse `aws.appian.cmcs.MCP_SPA_PCKG` (SEA Tool Compare / existing consumers; different contract).

---

## 2. Proposed connection (already documented)

The proposed **source-side connection** approach is published here:

- **[Database Approach (For MACPro)](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640)** — authoritative upstream design:
  1. Flat relational view at **SPA + RU** grain (latest/current version only)
  2. Reliable **max/latest update timestamp** per row for near-real-time CDC
  3. Second aggregation so BigMAC publishes closer to **one logical package/update payload** (RU/SRT grouped), aggregation near the database — not Kafka/KSQL joins
  4. BigMAC CDC publishes **changed/current** rows (not full historical MACPro history)
  5. Migrated active SPAs must still receive updates after cutover
     Business events / what SMART receives:
- **[Proposed Scope & Assumptions for MACPro → SMART Integration](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1463687348)**
- **[LOE & PI Planning Worksheet](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1471316917)**
- **[MACPro System to SMART Integration Strategy](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1435318902)**
  Topic compaction guidance (latest message per key):
- **[BigMac - Kafka Topic Compaction](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1191412622)**
  Existing Appian connector (today):
- **[MACPro Appian Connector runbook](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947)** — `source.jdbc.appian-connector-dbo-1` → `aws.appian.cmcs.MCP_SPA_PCKG`, poll 5 min, `timestamp+incrementing`

---

## 3. How BigMAC will publish (connector pattern)

Copy the existing Confluent JDBC source pattern in this repo:
| Setting | Current / proposed |
| --- | --- |
| Connector class | `io.confluent.connect.jdbc.JdbcSourceConnector` |
| Mode | `timestamp+incrementing` |
| Poll | Default **5 minutes** (`300000` ms) — confirm lag with SMART |
| Query | Frozen custom `SELECT` (not `SELECT *`) |
| Value format | JSON **with embedded Connect schema** (no Schema Registry) |
| Semantics | Each message = **entire current row** (latest state), not field diffs |
| Topic | **New** topic (name TBD when object name is final). Working placeholder only: `aws.appian.cmcs.{OBJECT_NAME}` |
| Kafka key | Stable **business id** (package/SPA) required for `cleanup.policy=compact` |
| Compaction | Preferred so consumers see latest version per key — see compaction page above |
Hard deletes are invisible to JDBC polling unless soft-delete / parent republish is designed into the source.

---

## 4. What we need from Database (minimum to start)

Draft is enough to scaffold; final val DDL can follow (~3–4 weeks Database LOE).

- Object name and type (table / view / MView); schema
- Final grain after aggregation (package-level payload vs SPA+RU rows) — align with [Database Approach](https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640)
- Unique business key for Kafka message key
- Draft columns + Oracle types + nullability + multi-value encoding (JSON CLOB, etc.)
- Incrementing unique ID + timestamp that advances on **every** publishable change
- Official-submission vs draft filter; delete/assignment-removal representation
- Same DB / `BIGMACREAD` grants?; volume; val/prod dates
- Written schema + one example row (contract for MuleSoft even without a registry)

### Details required to finish

Final DDL in val matching frozen SELECT; grants; proof timestamp moves on insert/update/assignment/status; index on `(timestamp, incrementing id)`; sample rows; Oracle type mappings; view refresh/lag if applicable; prod parity; topic creation ownership.

### Open questions (tracking)

1. Final object name after aggregation step?
2. One row = one package payload (preferred for BigMAC) or still SPA+RU?
3. Kafka key column(s)?
4. Timestamp + incrementing columns that never miss publishable changes?
5. How removals/deletes appear?
6. Poll interval preference vs 5 minutes?
7. Full snapshot on first connector start vs watermark after go-live?
8. Compaction confirmed for this topic?

---

## 5. BigMAC work (planning only — not started in code)

From [OY2-41437](https://jiraent.cms.gov/browse/OY2-41437) LOE comments:

- New compacted topic + create-topics support for `cleanup.policy=compact` if not already available
- Second Appian JDBC source/query + cursor columns + message key
- MuleSoft consume connection details (topic, ACLs/auth, consumer group) — not MuleSoft transforms
- OneMAC/Mako topic registration (connection mapping only), if required
- Alarms/health for the new connector; password rotation must cover all active connectors
- Do not change `MCP_SPA_PCKG` contract for Compare
  **What we can do before the table exists:** lock draft contract; agree topic/key/compaction/poll; document sample payload; plan scaffolding/gating — implementation waits on Database object in TEST/val.

---

## 6. References

| Doc                                     | Link                                                                  |
| --------------------------------------- | --------------------------------------------------------------------- |
| Jira LOE ticket                         | https://jiraent.cms.gov/browse/OY2-41437                              |
| This page on Confluence                 | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1490295440 |
| Database Approach (proposed connection) | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1303598640 |
| Proposed Scope & Assumptions            | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1463687348 |
| LOE worksheet                           | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1471316917 |
| Kafka Topic Compaction                  | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1191412622 |
| Appian connector runbook                | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1325806947 |
| Kafka Data Flow                         | https://confluenceent.cms.gov/pages/viewpage.action?pageId=1163265150 |
| Repo spec (this file)                   | `docs/macpro-smart-appian-connector-spec.md`                          |
