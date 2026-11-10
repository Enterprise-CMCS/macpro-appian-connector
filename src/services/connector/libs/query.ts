// String query for table MCP_SPA_PCKG
// Oracle column PCKG_ID was causing compatibility issues with the jdbc connector
export const queryString = `SELECT CAST(PCKG_ID AS NUMERIC(8,0)) AS PCKG_ID, REPLICA_TIMESTAMP, UPDT_TS, STATE_CD, RGN_CD, 
                    SPA_ID, CRNT_STUS, CRNT_STATE, PCKG_DSPSTN, PCKG_VRSN, PCKG_DRFT, PCKG_DAYS_ELPSD, 
                    PCKG_DAYS_ALLWD, SBMSSN_DATE, CREAT_USER_ID, CREAT_TS, UPDT_USER_ID, SRT_MLSTN_DATE, 
                    SRM_MLSTN_DATE, APPRVL_TS, SPA_PCKG_ID, PKG_YR, AUTHRTY_CD, PGM_CD, AUTHRTY_TYPE_CD, 
                    SBMSSN_TYPE, EFF_DATE, VWD_BY_OTHR_STATES, HLC_ID, SBMSSN_PKG_TYPE, SBMSSN_TYPE_PKG_ID, 
                    LOCK_FLAG, LOCK_BY, DLTD_FLAG, IS_CRNT_VRSN, IS_SBMTD, PRVNT_SUBMSN_FLAG, RVW_SQNC, 
                    RAI_FLAG, CLK_STUS, CNVRTD_FLAG, PEEK_FLAG, PRFL_ID, PRGRM_NAME, HLC_LVL_ID, ROUTG_INSTR, 
                    CLK_EXPRTN_FLAG, PRRTY_CD, SRC_DRAFT_PKG_ID, SUB_STUS FROM ${process.env.legacyschema}.MCP_SPA_PCKG`;

// Aggregated SMART view (OY2-41661 / OY2-42881). Column list verified against ALL_TAB_COLUMNS
// on MACPROTEST1 2026-11-10 (20 columns). PCKG_ID, SPA_PCKG_ID, and AUTHRTY_CD are no longer
// on the view; CNSLTN_DT and SOURCE_SYSTEM were added. Select CLOB columns natively:
// kafka-connect-jdbc maps CLOB to a Connect string and reads the full value. Do not convert
// with DBMS_LOB.SUBSTR — this DB has MAX_STRING_SIZE=STANDARD, so a VARCHAR2 result over
// 4000 chars errors (ORA-06502) instead of delivering the data, and at 4000 it silently
// truncates. Do not SELECT * — the embedded Connect schema is the consumer contract.
export const smartIntegrationQuery = `SELECT SPA_ID, STATE_CD, PGM_CD, EXEC_SUMMARY, CNSLTN_DT, SBMSSN_DATE,
                    PRRTY_CD, FRST_FED_FY, FRST_FED_FY_AMNT, SCND_FED_FY, SCND_FED_FY_AMNT,
                    CRNT_STUS, PKG_SUB_STUS, CRNT_STATE, RSPNS_TS, RQST_TS, SOURCE_SYSTEM,
                    REPLICA_TIMESTAMP, RU_JSON, REVIEWER_JSON
                    FROM ${process.env.legacyschema}.MCP_SMART_INTG_AGGRTN_VW`;
