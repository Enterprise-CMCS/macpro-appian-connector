import { queryString, smartIntegrationQuery } from "./query";
import connectorNames from "./connector-names.json";
import type { ConnectorConfig } from "../../../types";

export const SMART_INTEGRATION_INCREMENTING_COLUMN = "PCKG_ID";
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

// MACPro → SMART (OY2-41661). No Kafka message key (same as MCP_SPA_PCKG).
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
    mode: "timestamp+incrementing",
    "incrementing.column.name": SMART_INTEGRATION_INCREMENTING_COLUMN,
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
