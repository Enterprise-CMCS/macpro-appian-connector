import { queryString, smartIntegrationQuery } from "./query";
import connectorNames from "./connector-names.json";
import type { ConnectorConfig } from "../../../types";

// The aggregated view no longer exposes a unique numeric package id, so the
// JDBC source tracks changes with REPLICA_TIMESTAMP alone (mode=timestamp).
export const SMART_INTEGRATION_TIMESTAMP_COLUMN = "REPLICA_TIMESTAMP";

// Each connector's JDBC settings are written inline on purpose: duplicated
// connection values are intentional so each config reads on its own.
export const appianDboConnector: ConnectorConfig = {
  name: connectorNames.appianDbo,
  config: {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "tasks.max": 1,
    "connection.attempts": 1,
    "connection.user": process.env.legacydbUser || "",
    "connection.password": process.env.legacydbPassword || "",
    "connection.url": `jdbc:oracle:thin:@${process.env.legacydbIp}:${process.env.legacydbPort}:${process.env.legacyDb}`,
    "topic.prefix": `${process.env.topicNamespace}aws.appian.cmcs.MCP_SPA_PCKG`,
    query: queryString,
    mode: "timestamp+incrementing",
    "incrementing.column.name": "PCKG_ID",
    "timestamp.column.name": "REPLICA_TIMESTAMP",
    "poll.interval.ms": 300000,
    "batch.max.rows": 1000,
    "validate.non.null": false,
    "numeric.mapping": "best_fit",
    "key.converter": "org.apache.kafka.connect.json.JsonConverter",
    "key.converter.schemas.enable": false,
  },
};

// MACPro → SMART (OY2-41661 / OY2-42881). No Kafka message key (same as MCP_SPA_PCKG).
export const smartIntegrationConnector: ConnectorConfig = {
  name: connectorNames.appianSmart,
  config: {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "tasks.max": 1,
    "connection.attempts": 1,
    "connection.user": process.env.legacydbUser || "",
    "connection.password": process.env.legacydbPassword || "",
    "connection.url": `jdbc:oracle:thin:@${process.env.legacydbIp}:${process.env.legacydbPort}:${process.env.legacyDb}`,
    "topic.prefix": `${process.env.topicNamespace}aws.appian.cmcs.MCP_SMART_INTG_AGGRTN_VW`,
    query: smartIntegrationQuery,
    mode: "timestamp",
    "timestamp.column.name": SMART_INTEGRATION_TIMESTAMP_COLUMN,
    "poll.interval.ms": 300000,
    "batch.max.rows": 1000,
    "validate.non.null": false,
    "numeric.mapping": "best_fit",
    "key.converter": "org.apache.kafka.connect.json.JsonConverter",
    "key.converter.schemas.enable": false,
  },
};

export const connectors: ConnectorConfig[] = [appianDboConnector, smartIntegrationConnector];

// The stack sets `connectorNames` per stage so a connector can be held back where its source is not ready.
export function enabledConnectors(connectorNamesCsv: string | undefined): ConnectorConfig[] {
  const names = (connectorNamesCsv ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error("Environment variable 'connectorNames' is required");
  }
  return names.map((name) => {
    const connector = connectors.find((item) => item.name === name);
    if (!connector) {
      throw new Error(`Unknown connector name in 'connectorNames': ${name}`);
    }
    return connector;
  });
}
