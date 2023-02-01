SET 'auto.offset.reset' = 'earliest';

--Join form fields with their descriptions
CREATE TABLE IF NOT EXISTS K_mmdl_tld_FORM_FIELDS_TBL
  WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.tld.FORM_FIELD_TBL',KEY_FORMAT='JSON') AS
  SELECT detail.PLAN_WVR_RVSN_VRSN_ID AS revision_version_id,
         detail.PLAN_WVR_FLD_MPNG_ID field_mapping_id,
         mapping.Plan_Wvr_Fld_Mpng->PLAN_WVR_FLD_MPNG_DESC AS field_description,
         mapping.Plan_Wvr_Fld_Mpng->PLAN_WVR_FLD_MPNG_NAME AS field_name,
         detail.Plan_Wvr_Vrsn_Dtl->SYS_DTL_VAL_TXT AS field_value,
         mapping.Plan_Wvr_Fld_Mpng->PLAN_WVR_FLD_MPNG_DTYPE_NAME AS field_mapping_data_type,
         detail.Plan_Wvr_Vrsn_Dtl->APLCTN_CHG_TYPE_CD AS change_type_code,
         mapping.Plan_Wvr_Fld_Mpng->PLAN_WVR_FLD_MPNG_NOTE_TXT field_mapping_note_text,
         mapping.Plan_Wvr_Fld_Mpng->PLAN_WVR_PGM_TYPE_CD AS program_type_code
    FROM K_mmdl_eld_PLAN_WVR_VRSN_DTL_TBL detail
    JOIN K_mmdl_eld_PLAN_WVR_FLD_MPNG_TBL mapping ON detail.PLAN_WVR_FLD_MPNG_ID = mapping.PLAN_WVR_FLD_MPNG_ID
EMIT CHANGES;

--Join form fields with versions of revisions
CREATE TABLE IF NOT EXISTS K_mmdl_tld_REVISION_VERSION_TBL
WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.tld.K_mmdl_tld_REVISION_VERSION_TBL',KEY_FORMAT='JSON') AS
  SELECT revision_version.Plan_Wvr_Rvsn_Vrsn->PLAN_WVR_RVSN_ID AS revision_id,
         form_fields.revision_version_id AS revision_version_id,
         revision_version.Plan_Wvr_Rvsn_Vrsn->PLAN_WVR_RVSN_TITLE_DESC revision_title_description,
         revision_version.Plan_Wvr_Rvsn_Vrsn->PLAN_WVR_RVSN_WVR_DESC revision_version_waiver_desciption,
         revision_version.Plan_Wvr_Rvsn_Vrsn->PLAN_WVR_MODEL_TYPE_CD revision_version_model_type_code,
         form_fields.field_mapping_id,
         form_fields.field_description,
         form_fields.field_name,
         form_fields.field_value,
         form_fields.field_mapping_data_type,
         form_fields.change_type_code,
         form_fields.field_mapping_note_text,
         form_fields.program_type_code
  FROM K_mmdl_tld_FORM_FIELDS_TBL form_fields
  JOIN K_mmdl_eld_PLAN_WVR_RVSN_VRSN_TBL revision_version ON form_fields.revision_version_id = revision_version.PLAN_WVR_RVSN_VRSN_ID
EMIT CHANGES;

--Join revisions with versions of form data to create the comprehensive version history
CREATE TABLE IF NOT EXISTS K_mmdl_tld_WAIVER_REVISION_TBL
WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.tld.K_mmdl_WAIVER_REVISION_TBL',KEY_FORMAT='JSON') AS
SELECT revision.Plan_Wvr_Rvsn->PLAN_WVR_ID AS waiver_id,
       revision.PLAN_WVR_RVSN_ID AS revision_id,
       revision_version.revision_version_id AS revision_version_id,
       revision_version.revision_title_description AS revision_title_description,
       revision_version.revision_version_waiver_desciption AS revision_version_waiver_desciption,
       revision_version.revision_version_model_type_code AS revision_version_model_type_code,
       revision_version.field_mapping_id AS field_mapping_id,
       revision_version.field_description AS field_description,
       revision_version.field_name AS field_name,
       revision_version.field_value AS field_value,
       revision_version.field_mapping_data_type AS field_mapping_data_type,
       revision_version.change_type_code AS change_type_code,
       revision_version.field_mapping_note_text AS field_mapping_note_text,
       revision_version.program_type_code AS program_type_code,
       revision.Plan_Wvr_Rvsn->PLAN_WVR_RVSN_RQST_TYPE_CD AS revision_request_type_code,
       revision.Plan_Wvr_Rvsn->PLAN_WVR_RVSN_APRVD_EFCTV_DT AS revision_approved_effective_date,
       revision.Plan_Wvr_Rvsn->PLAN_WVR_TYPE_CD AS waiver_type_code,
       revision.Plan_Wvr_Rvsn->PLAN_WVR_RVSN_TITLE_TXT AS waiver_revision_title_text,
       revision.Plan_Wvr_Rvsn->PLAN_WVR_RVSN_EXPRTN_DT AS waiver_revision_expiration_date,
       revision.Plan_Wvr_Rvsn->PLAN_WVR_RVSN_APRVD_DT AS waiver_revision_approved_date
  FROM K_mmdl_tld_REVISION_VERSION_TBL revision_version
  JOIN K_mmdl_eld_PLAN_WVR_RVSN_TBL revision ON revision_version.revision_id = revision.PLAN_WVR_RVSN_ID
EMIT CHANGES;

--This stream sits on the same topic as the previous table to allow
--collecting the last version of each record type in the version history
CREATE STREAM IF NOT EXISTS K_mmdl_tld_PLAN_WAIVER_REVISION_TBL_stream (
  PK STRUCT <
    REVISION_VERSION_ID INTEGER,
    FIELD_MAPPING_ID INTEGER
  > KEY,
  waiver_id INTEGER,
  revision_id INTEGER,
  revision_version_id INTEGER,
  revision_title_description VARCHAR,
  revision_version_waiver_desciption VARCHAR,
  revision_version_model_type_code VARCHAR,
  field_description VARCHAR,
  field_name VARCHAR,
  field_value VARCHAR,
  field_mapping_data_type VARCHAR,
  change_type_code VARCHAR,
  field_mapping_note_text VARCHAR,
  program_type_code VARCHAR,
  revision_request_type_code VARCHAR,
  revision_approved_effective_date TIMESTAMP,
  waiver_type_code VARCHAR,
  waiver_revision_title_text VARCHAR,
  waiver_revision_expiration_date TIMESTAMP,
  waiver_revision_approved_date TIMESTAMP
)
WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.tld.K_mmdl_WAIVER_REVISION_TBL',VALUE_FORMAT='JSON',KEY_FORMAT='JSON');

--Collect the last entry for each form field type from the version history
CREATE TABLE IF NOT EXISTS K_mmdl_tld_WAIVER_FORM_FIELD_VERSIONS_TBL
WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.tld.K_mmdl_WAIVER_FORM_FIELDS_TBL',KEY_FORMAT='JSON') AS
SELECT waiver_id, PK->field_mapping_id,
       LATEST_BY_OFFSET(revision_id) AS revision_id,
       LATEST_BY_OFFSET(PK->revision_version_id) AS revision_version_id,
       LATEST_BY_OFFSET(revision_title_description) AS revision_title_description,
       LATEST_BY_OFFSET(revision_version_waiver_desciption) AS revision_version_waiver_desciption,
       LATEST_BY_OFFSET(revision_version_model_type_code) AS revision_version_model_type_code,
       LATEST_BY_OFFSET(field_description) AS field_description,
       LATEST_BY_OFFSET(field_name) AS field_name,
       LATEST_BY_OFFSET(field_value) AS field_value,
       LATEST_BY_OFFSET(field_mapping_data_type) AS field_mapping_data_type,
       LATEST_BY_OFFSET(change_type_code) AS change_type_code,
       LATEST_BY_OFFSET(field_mapping_note_text) AS field_mapping_note_text,
       LATEST_BY_OFFSET(program_type_code) AS program_type_code,
       LATEST_BY_OFFSET(revision_request_type_code) AS revision_request_type_code,
       LATEST_BY_OFFSET(revision_approved_effective_date) AS revision_approved_effective_date,
       LATEST_BY_OFFSET(waiver_type_code) AS waiver_type_code,
       LATEST_BY_OFFSET(waiver_revision_title_text) AS waiver_revision_title_text,
       LATEST_BY_OFFSET(waiver_revision_expiration_date) AS waiver_revision_expiration_date,
       LATEST_BY_OFFSET(waiver_revision_approved_date) AS waiver_revision_approved_date
  FROM K_mmdl_tld_PLAN_WAIVER_REVISION_TBL_stream
  GROUP BY waiver_id, PK->field_mapping_id
EMIT CHANGES;

--Aggregate and organize as MAP for ease of parsing
CREATE TABLE IF NOT EXISTS K_mmdl_agg_MMDL_WAIVER_TBL
WITH (KAFKA_TOPIC='${param:topicNamespace}aws.ksqldb.mmdl.agg.K_mmdl_agg_MMDL_WAIVER_TBL',KEY_FORMAT='JSON',WRAP_SINGLE_VALUE=FALSE) AS
SELECT waiver_id,
       AS_MAP(
         COLLECT_LIST(field_name),
         COLLECT_LIST(
           STRUCT(
             field_name := field_name,
             field_description := field_description,
             field_value := field_value,
             field_mapping_data_type := field_mapping_data_type,
             field_change_type_code := change_type_code,
             field_mapping_note_text := field_mapping_note_text,
             field_program_type_code := program_type_code,
             revision_id := revision_id,
             revision_title_description := revision_title_description,
             revision_request_type_code := revision_request_type_code,
             revision_approved_effective_date := revision_approved_effective_date,
             revision_version_id := revision_version_id,
             revision_version_waiver_desciption := revision_version_waiver_desciption,
             revision_version_model_type_code := revision_version_model_type_code,
             waiver_type_code := waiver_type_code,
             waiver_revision_title_text := waiver_revision_title_text,
             waiver_revision_approved_date := waiver_revision_approved_date,
             waiver_revision_expiration_date := waiver_revision_expiration_date
           )
         )
       ) AS form_fields,
       base_waiver.Plan_Base_Wvr->GEO_USPS_STATE_CD AS state_code,
       base_waiver.Plan_Base_Wvr->PLAN_WVR_GRP_TYPE_CD AS group_code,
       base_waiver.Plan_Base_Wvr->PLAN_WVR_PGM_TYPE_CD AS program_type_code
  FROM K_mmdl_tld_WAIVER_FORM_FIELD_VERSIONS_TBL form_field_versions
  JOIN K_mmdl_eld_PLAN_BASE_WVR_TBL base_waiver ON form_field_versions.waiver_id = base_waiver.PLAN_WVR_ID
  GROUP BY waiver_id,
           base_waiver.Plan_Base_Wvr->GEO_USPS_STATE_CD,
           base_waiver.Plan_Base_Wvr->PLAN_WVR_GRP_TYPE_CD,
           base_waiver.Plan_Base_Wvr->PLAN_WVR_PGM_TYPE_CD
EMIT CHANGES;
