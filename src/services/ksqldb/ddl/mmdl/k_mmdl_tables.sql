SET 'auto.offset.reset' = 'earliest';

CREATE TABLE IF NOT EXISTS K_mmdl_eld_PLAN_BASE_WVR_TBL
  WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.eld.PLAN_BASE_WVR_TBL',KEY_FORMAT='JSON',WRAP_SINGLE_VALUE=FALSE) AS
  SELECT payload->PLAN_WVR_ID, LATEST_BY_OFFSET(payload, FALSE) as Plan_Base_Wvr
    FROM K_mmdl_PLAN_BASE_WVR_TBL_stream
GROUP BY payload->PLAN_WVR_ID
EMIT CHANGES;

CREATE TABLE IF NOT EXISTS K_mmdl_eld_GEO_US_STATE_TBL
  WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.eld.GEO_US_STATE_TBL',KEY_FORMAT='JSON',WRAP_SINGLE_VALUE=FALSE) AS
  SELECT payload->APLCTN_GEO_STATE_ID, LATEST_BY_OFFSET(payload, FALSE) as Geo_US_State
    FROM K_mmdl_GEO_US_STATE_TBL_stream
GROUP BY payload->APLCTN_GEO_STATE_ID
EMIT CHANGES;

CREATE TABLE IF NOT EXISTS K_mmdl_eld_PLAN_WVR_RVSN_TBL
  WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.eld.PLAN_WVR_RVSN_TBL',KEY_FORMAT='JSON',WRAP_SINGLE_VALUE=FALSE) AS
  SELECT payload->PLAN_WVR_RVSN_ID, LATEST_BY_OFFSET(payload, FALSE) as Plan_Wvr_Rvsn
    FROM K_mmdl_PLAN_WVR_RVSN_TBL_stream
GROUP BY payload->PLAN_WVR_RVSN_ID
EMIT CHANGES;

CREATE TABLE IF NOT EXISTS K_mmdl_eld_PLAN_WVR_RVSN_VRSN_TBL
  WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.eld.PLAN_WVR_RVSN_VRSN_TBL',KEY_FORMAT='JSON',WRAP_SINGLE_VALUE=FALSE) AS
  SELECT payload->PLAN_WVR_RVSN_VRSN_ID, LATEST_BY_OFFSET(payload, FALSE) as Plan_Wvr_Rvsn_Vrsn
    FROM K_mmdl_PLAN_WVR_RVSN_VRSN_TBL_stream
GROUP BY payload->PLAN_WVR_RVSN_VRSN_ID
EMIT CHANGES;

CREATE TABLE IF NOT EXISTS K_mmdl_eld_PLAN_WVR_VRSN_DTL_TBL
  WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.eld.PLAN_WVR_VRSN_DTL_TBL',KEY_FORMAT='JSON',WRAP_SINGLE_VALUE=FALSE) AS
  SELECT payload->PLAN_WVR_RVSN_VRSN_ID, payload->PLAN_WVR_FLD_MPNG_ID, LATEST_BY_OFFSET(payload, FALSE) as Plan_Wvr_Vrsn_Dtl
    FROM K_mmdl_PLAN_WVR_VRSN_DTL_TBL_stream
GROUP BY payload->PLAN_WVR_RVSN_VRSN_ID, payload->PLAN_WVR_FLD_MPNG_ID
EMIT CHANGES;

CREATE TABLE IF NOT EXISTS K_mmdl_eld_PLAN_WVR_FLD_MPNG_TBL
  WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.eld.PLAN_WVR_FLD_MPNG_TBL',KEY_FORMAT='JSON',WRAP_SINGLE_VALUE=FALSE) AS
  SELECT payload->PLAN_WVR_FLD_MPNG_ID, LATEST_BY_OFFSET(payload, FALSE) as Plan_Wvr_Fld_Mpng
    FROM K_mmdl_PLAN_WVR_FLD_MPNG_TBL_stream
GROUP BY payload->PLAN_WVR_FLD_MPNG_ID
EMIT CHANGES;
