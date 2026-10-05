const AUTH_CODES = new Set(["ORA-01017", "ORA-28000"]);
const ACCOUNT_LOCKED = /account locked/i;

export type OracleTraceClass = "auth" | "oracle";

export interface OracleTraceClassification {
  authFailure: boolean;
  oracleError: boolean;
  code?: string;
  oracleClass?: OracleTraceClass;
}

export function classifyOracleTaskTraces(
  tasks: ReadonlyArray<{ trace?: string | null }>
): OracleTraceClassification {
  const traces = tasks
    .map((task) => task.trace)
    .filter((trace): trace is string => typeof trace === "string" && trace.length > 0);

  const codes = traces
    .flatMap((trace) => [...trace.matchAll(/ORA-\d+/gi)])
    .map((match) => match[0].toUpperCase());
  const accountLocked = traces.some((trace) => ACCOUNT_LOCKED.test(trace));
  const authCode = codes.find((code) => AUTH_CODES.has(code));

  if (authCode !== undefined || accountLocked) {
    return {
      authFailure: true,
      oracleError: true,
      code: authCode ?? "account locked",
      oracleClass: "auth",
    };
  }

  const otherCode = codes.find((code) => !AUTH_CODES.has(code));
  if (otherCode !== undefined) {
    return {
      authFailure: false,
      oracleError: true,
      code: otherCode,
      oracleClass: "oracle",
    };
  }

  return {
    authFailure: false,
    oracleError: false,
  };
}

export function formatOracleConnectorLog(
  connectorName: string,
  code: string,
  oracleClass: OracleTraceClass
): string {
  return `ORACLE_CONNECTOR_ERROR connector=${connectorName} code=${code} class=${oracleClass}`;
}
