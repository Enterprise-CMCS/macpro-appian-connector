import { queryString, smartIntegrationQuery } from "./query";
import connectorNames from "./connector-names.json";
import type { ConnectorConfig } from "../../../types";

// Pending Database confirmation: per-change unique ID and change timestamp on MCP_SMART_INTEGRATION_VW.
// PCKG_ID is not unique per row (RU/assignment repetition) and cannot be the incrementing column.
export const SMART_INTEGRATION_INCREMENTING_COLUMN = "CHANGE_ID";
export const SMART_INTEGRATION_TIMESTAMP_COLUMN = "CHANGE_TIMESTAMP";

export const connectors: ConnectorConfig[] = [
  {
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
  },
];

// Staged for MACPro → SMART (OY2-41661). Not in `connectors` or connector-names.json until
// the connector read-only login has SELECT on MCP_SMART_INTEGRATION_VW — do not PUT or health-check this config yet.
// tasks.max stays 0 until column names, grants, and topic setup are confirmed so no task connects to Oracle.
export const smartIntegrationConnector: ConnectorConfig = {
  name: "source.jdbc.appian-connector-smart-1",
  config: {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "tasks.max": 0,
    "connection.attempts": 1,
    "connection.user": process.env.legacydbUser || "",
    "connection.password": process.env.legacydbPassword || "",
    "connection.url": `jdbc:oracle:thin:@${process.env.legacydbIp}:${process.env.legacydbPort}:${process.env.legacyDb}`,
    "topic.prefix": `${process.env.topicNamespace}aws.appian.cmcs.MCP_SMART_INTEGRATION_VW`,
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
    transforms: "createKey,extractKey",
    "transforms.createKey.type": "org.apache.kafka.connect.transforms.ValueToKey",
    "transforms.createKey.fields": "SPA_PCKG_ID",
    "transforms.extractKey.type": "org.apache.kafka.connect.transforms.ExtractField$Key",
    "transforms.extractKey.field": "SPA_PCKG_ID",
  },
};
