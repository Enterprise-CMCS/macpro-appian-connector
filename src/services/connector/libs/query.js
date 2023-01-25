// String query for table MCP_SPA_PCKG. Oracle column PCKG_ID was causing compatability issues with the jdbc connector
export const queryString = `SELECT CAST(PCKG_ID AS NUMERIC(38,0)) AS PCKG_ID, UPDT_TS, STATE_CD, RGN_CD, 
                    SPA_ID, CRNT_STUS, CRNT_STATE, PCKG_DSPSTN, PCKG_VRSN, PCKG_DRFT, PCKG_DAYS_ELPSD, 
                    PCKG_DAYS_ALLWD, SBMSSN_DATE, CREAT_USER_ID, CREAT_TS, UPDT_USER_ID, SRT_MLSTN_DATE, 
                    SRM_MLSTN_DATE, APPRVL_TS, SPA_PCKG_ID, PKG_YR, AUTHRTY_CD, PGM_CD, AUTHRTY_TYPE_CD, 
                    SBMSSN_TYPE, EFF_DATE, VWD_BY_OTHR_STATES, HLC_ID, SBMSSN_PKG_TYPE, SBMSSN_TYPE_PKG_ID, 
                    LOCK_FLAG, LOCK_BY, DLTD_FLAG, IS_CRNT_VRSN FROM ${process.env.legacyschema}.MCP_SPA_PCKG`;
