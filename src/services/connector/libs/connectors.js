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
      "topic.prefix": `${process.env.topicNamespace}aws.appian.cdc.`,
      "poll.interval.ms": 2000,
      "batch.max.rows": 1000,
      mode: "timestamp+incrementing",
      "table.whitelist": `${process.env.legacyschema}.MCP_SPA_PCKG`,
      [`table.${process.env.legacyschema}.MCP_SPA_PCKG.query`]: queryString,
      "incrementing.column.name": "PCKG_ID",
      "timestamp.column.name": "UPDT_TS",
      "validate.non.null": false,
      "numeric.mapping": "best_fit",
      "key.converter": "org.apache.kafka.connect.json.JsonConverter",
      "key.converter.schemas.enable": false,
    },
  },
];

      // "value.converter": "org.apache.kafka.connect.json.JsonConverter",
      // "value.converter.schemas.enable": false,
      // transforms: "createKey,extractInt,Cast",
      // "transforms.createKey.type":
      //   "org.apache.kafka.connect.transforms.ValueToKey",
      // "transforms.createKey.fields": "PCKG_ID",
      // "transforms.extractInt.type":
      //   "org.apache.kafka.connect.transforms.ExtractField$Key",
      // "transforms.extractInt.field": "PCKG_ID",
      // "transforms.Cast.type": "org.apache.kafka.connect.transforms.Cast$Value",
      // "transforms.Cast.spec":"PCKG_ID:int32",