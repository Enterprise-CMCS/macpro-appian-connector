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
      query: `SELECT CAST(PCKG_ID AS NUMERIC(38,0)) AS PCKG_ID, UPDT_TS, STATE_CD, RGN_CD, SPA_ID, CRNT_STUS, CRNT_STATE, PCKG_DSPSTN, PCKG_VRSN, PCKG_DRFT, PCKG_DAYS_ELPSD, PCKG_DAYS_ALLWD, SBMSSN_DATE, CREAT_USER_ID, CREAT_TS, UPDT_USER_ID, SRT_MLSTN_DATE, SRM_MLSTN_DATE FROM ${process.env.legacyschema}.MCP_SPA_PCKG`,
      "incrementing.column.name": "PCKG_ID",
      "timestamp.column.name": "UPDT_TS",
      "validate.non.null": false,
      "numeric.mapping": "best_fit",
      "key.converter": "org.apache.kafka.connect.json.JsonConverter",
      "key.converter.schemas.enable": false,
    },
  },
];
