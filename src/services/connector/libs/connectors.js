export const connectors = [
  {
    name: "source.jdbc.mmdl-dbo-1",
    config: {
      "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
      "tasks.max": 1,
      "connection.user": process.env.legacydbUser,
      "connection.password": process.env.legacydbPassword,
      "connection.url": `jdbc:oracle:thin:@${process.env.legacydbIp}:${process.env.legacydbPort}:${process.env.legacyDb}`,
      "topic.prefix": `${process.env.topicNamespace}aws.mmdl.cdc.`,
      "poll.interval.ms": 2000,
      "batch.max.rows": 1000,
      "table.whitelist":
        "MMDL.PLAN_BASE_WVR_TBL, MMDL.PLAN_WVR_FLD_MPNG_TBL, MMDL.PLAN_WVR_RVSN_TBL, MMDL.PLAN_WVR_RVSN_VRSN_TBL, MMDL.PLAN_WVR_VRSN_DTL_TBL, SHAREDDATA.GEO_US_STATE_TBL",
      mode: "timestamp+incrementing",
      "incrementing.column.name": "REPLICA_ID",
      "timestamp.column.name": "REPLICA_TIMESTAMP",
      "validate.non.null": false,
      "numeric.mapping": "best_fit",
      "key.converter": "org.apache.kafka.connect.json.JsonConverter",
      "key.converter.schemas.enable": false,
      transforms: "Cast,createKey,extractInt",
      "transforms.createKey.type":
        "org.apache.kafka.connect.transforms.ValueToKey",
      "transforms.createKey.fields": "REPLICA_ID",
      "transforms.extractInt.type":
        "org.apache.kafka.connect.transforms.ExtractField$Key",
      "transforms.extractInt.field": "REPLICA_ID",
      "transforms.Cast.type": "org.apache.kafka.connect.transforms.Cast$Value",
      "transforms.Cast.spec":
        "APLCTN_GEO_STATE_ID:int32, APLCTN_CO_WRKFLW_STUS_ID:int32, APLCTN_RO_WRKFLW_STUS_ID:int32, APLCTN_WRKFLW_STUS_ID:int32, PLAN_WVR_APLCTN_ID:int32, PLAN_WVR_DEMO_GRNT_SW:int32, PLAN_WVR_FLD_MPNG_CPY_SW:int32, PLAN_WVR_FLD_MPNG_DTL_SW:int32, PLAN_WVR_FLD_MPNG_ID:int32, PLAN_WVR_FLD_MPNG_PAGE_NUM:int32, PLAN_WVR_FLD_MPNG_PAGE_SQNC:int32, PLAN_WVR_ID:int32, PLAN_WVR_RVSN_APRVL_PRD:int32, PLAN_WVR_RVSN_ID:int32, PLAN_WVR_RVSN_INIT_WVR_SW:int32, PLAN_WVR_RVSN_PRNT_ID:int32, PLAN_WVR_RVSN_VRSN_DTL_ID:int32, PLAN_WVR_RVSN_VRSN_ID:int32, REPLICA_ID:int32, SYS_ADD_USER_ID:int32, SYS_UPDT_USER_ID:int32",
    },
  },
];
