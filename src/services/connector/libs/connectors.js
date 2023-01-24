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
      query: `SELECT CAST(PCKG_ID AS NUMERIC(38,0)) AS PCKG_ID, STATE_CD,RGN_CD, SPA_ID, CRNT_STUS, CRNT_STATE, PCKG_DSPSTN, PCKG_VRSN, PCKG_DRFT, PCKG_DAYS_ELPSD, PCKG_DAYS_ALLWD, SBMSSN_DATE, CREAT_USER_ID, CREAT_TS, UPDT_USER_ID, UPDT_TS, SRT_MLSTN_DATE, SRM_MLSTN_DATE, APPRVL_TS, SPA_PCKG_ID, PKG_YR, AUTHRTY_CD, PGM_CD, AUTHRTY_TYPE_CD, SBMSSN_TYPE, EFF_DATE, VWD_BY_OTHR_STATES, HLC_ID, SBMSSN_PKG_TYPE, SBMSSN_TYPE_PKG_ID, LOCK_FLAG, LOCK_BY, DLTD_FLAG, IS_CRNT_VRSN, IS_SBMTD, PRVNT_SUBMSN_FLAG, RVW_SQNC, RVW_SQNC, RAI_FLAG, CLK_STUS, CNVRTD_FLAG, PEEK_FLAG, PRFL_ID, PRGRM_NAME, HLC_LVL_ID, ROUTG_INSTR, CLK_EXPRTN_FLAG, PRRTY_CD, SRC_DRAFT_PKG_ID, SUB_STUS FROM ${process.env.legacyschema}.MCP_SPA_PCKG`,
      "incrementing.column.name": "PCKG_ID",
      "timestamp.column.name": "UPDT_TS",
      "validate.non.null": false,
      "numeric.mapping": "best_fit",
      "key.converter": "org.apache.kafka.connect.json.JsonConverter",
      "key.converter.schemas.enable": false,
    },
  },
];
