import { queryString } from "./query";

export const connectors = [
  {
    name: "source.jdbc.appian-dbo-1",
    config: {
      "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
      "tasks.max": 1,
      "connection.user": process.env.legacydbUser,
      "connection.password": process.env.legacydbPassword,
      "connection.url": `jdbc:oracle:thin:@${process.env.legacydbIp}:${process.env.legacydbPort}:${process.env.legacyDb}`,
      "topic.prefix": `${process.env.topicNamespace}aws.appian.cdc.MCP_SPA_PCKG`,
      "poll.interval.ms": 2000,
      "batch.max.rows": 1000,
      query: queryString,
      mode: "timestamp+incrementing",
      "incrementing.column.name": "PCKG_ID",
      "timestamp.column.name": "UPDT_TS",
      "validate.non.null": false,
      "numeric.mapping": "best_fit",
      "key.converter": "org.apache.kafka.connect.json.JsonConverter",
      "key.converter.schemas.enable": false,
    },
  },
];
