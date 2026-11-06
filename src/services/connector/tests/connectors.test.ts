import { describe, expect, it } from "vitest";
import connectorNames from "../libs/connector-names.json";
import {
  connectors,
  smartIntegrationConnector,
  SMART_INTEGRATION_INCREMENTING_COLUMN,
  SMART_INTEGRATION_TIMESTAMP_COLUMN,
} from "../libs/connectors";
import { smartIntegrationQuery } from "../libs/query";

describe("connector names", () => {
  it("defines exactly one connector config per name in connector-names.json", () => {
    expect(connectors.map((connector) => connector.name).sort()).toEqual(Object.values(connectorNames).sort());
  });

  it("keeps the live connector name", () => {
    expect(connectorNames.appianDbo).toBe("source.jdbc.appian-connector-dbo-1");
  });

  it("makes one login attempt per task start", () => {
    for (const connector of connectors) {
      expect(connector.config["connection.attempts"]).toBe(1);
    }
  });
});

describe("smart integration connector", () => {
  it("is in the deployed connectors list and connector-names.json", () => {
    expect(connectors.map((connector) => connector.name)).toContain(smartIntegrationConnector.name);
    expect(Object.values(connectorNames)).toContain(smartIntegrationConnector.name);
    expect(connectorNames.appianSmart).toBe("source.jdbc.appian-connector-smart-1");
  });

  it("runs one task", () => {
    expect(smartIntegrationConnector.config["tasks.max"]).toBe(1);
  });

  it("uses the SMART aggregated view topic name", () => {
    expect(String(smartIntegrationConnector.config["topic.prefix"])).toContain(
      "aws.appian.cmcs.MCP_SMART_INTG_AGGRTN_VW"
    );
    expect(smartIntegrationConnector.config["topic.prefix"]).toBe(
      `${process.env.topicNamespace}aws.appian.cmcs.MCP_SMART_INTG_AGGRTN_VW`
    );
  });

  it("reads MCP_SMART_INTG_AGGRTN_VW from legacyschema", () => {
    expect(smartIntegrationQuery).toMatch(/FROM .+\.MCP_SMART_INTG_AGGRTN_VW/);
    expect(smartIntegrationConnector.config.query).toBe(smartIntegrationQuery);
  });

  it("casts PCKG_ID and selects CLOB columns natively without truncation", () => {
    expect(smartIntegrationQuery).toMatch(/CAST\(PCKG_ID AS NUMERIC\(8,0\)\) AS PCKG_ID/);
    expect(smartIntegrationQuery).toMatch(/REPLICA_TIMESTAMP/);
    expect(smartIntegrationQuery).toMatch(/\bRU_JSON\b/);
    expect(smartIntegrationQuery).toMatch(/\bREVIEWER_JSON\b/);
    expect(smartIntegrationQuery).not.toMatch(/DBMS_LOB\.SUBSTR/);
    expect(smartIntegrationQuery).not.toMatch(/SELECT \*/);
  });

  it("selects every column on the aggregated view", () => {
    for (const column of [
      "SCND_FED_FY_AMNT",
      "RSPNS_TS",
      "RQST_TS",
      "SPA_ID",
      "SPA_PCKG_ID",
      "STATE_CD",
      "PGM_CD",
      "EXEC_SUMMARY",
      "AUTHRTY_CD",
      "SBMSSN_DATE",
      "CRNT_STUS",
      "PKG_SUB_STUS",
      "CRNT_STATE",
      "PRRTY_CD",
      "FRST_FED_FY",
      "FRST_FED_FY_AMNT",
      "SCND_FED_FY",
    ]) {
      expect(smartIntegrationQuery).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("reuses the existing JDBC connection settings", () => {
    const existing = connectors[0].config;
    expect(smartIntegrationConnector.config["connection.attempts"]).toBe(1);
    expect(smartIntegrationConnector.config["connector.class"]).toBe(existing["connector.class"]);
    expect(smartIntegrationConnector.config["connection.user"]).toBe(existing["connection.user"]);
    expect(smartIntegrationConnector.config["connection.password"]).toBe(existing["connection.password"]);
    expect(smartIntegrationConnector.config["connection.url"]).toBe(existing["connection.url"]);
    expect(smartIntegrationConnector.config["poll.interval.ms"]).toBe(existing["poll.interval.ms"]);
    expect(smartIntegrationConnector.config.mode).toBe("timestamp+incrementing");
  });

  it("does not set a Kafka message key", () => {
    expect(smartIntegrationConnector.config.transforms).toBeUndefined();
    expect(smartIntegrationConnector.config["transforms.createKey.fields"]).toBeUndefined();
    expect(smartIntegrationConnector.config["transforms.extractKey.field"]).toBeUndefined();
  });

  it("tracks changes with REPLICA_TIMESTAMP and PCKG_ID", () => {
    expect(SMART_INTEGRATION_TIMESTAMP_COLUMN).toBe("REPLICA_TIMESTAMP");
    expect(SMART_INTEGRATION_INCREMENTING_COLUMN).toBe("PCKG_ID");
    expect(smartIntegrationConnector.config["timestamp.column.name"]).toBe(
      SMART_INTEGRATION_TIMESTAMP_COLUMN
    );
    expect(smartIntegrationConnector.config["incrementing.column.name"]).toBe(
      SMART_INTEGRATION_INCREMENTING_COLUMN
    );
  });
});
