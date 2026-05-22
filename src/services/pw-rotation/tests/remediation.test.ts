import { describe, expect, it } from "vitest";
import { buildRemediationPlan } from "../libs/remediation";
import type { VerificationOutcome } from "../libs/types";

describe("buildRemediationPlan", () => {
  it("describes parse_event failures", () => {
    const plan = buildRemediationPlan({ phase: "parse_event", errorMessage: "bad event" });
    expect(plan.summary).toMatch(/could not parse/i);
    expect(plan.steps).toHaveLength(1);
  });

  it("describes read_secret failures with secret-specific steps", () => {
    const plan = buildRemediationPlan({ phase: "read_secret", errorMessage: "AccessDenied" });
    expect(plan.steps.map((s) => s.title)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Confirm the secret value/i),
        expect.stringMatching(/IAM permissions/i),
      ]),
    );
  });

  it("describes update_lambda_env failures", () => {
    const plan = buildRemediationPlan({
      phase: "update_lambda_env",
      errorMessage: "UpdateInProgress",
    });
    expect(plan.steps.map((s) => s.title)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Re-run the rotation/i)]),
    );
  });

  it("describes invoke_configure_connectors failures", () => {
    const plan = buildRemediationPlan({
      phase: "invoke_configure_connectors",
      errorMessage: "boom",
    });
    expect(plan.steps.map((s) => s.title)).toEqual(
      expect.arrayContaining([expect.stringMatching(/configureConnectors logs/i)]),
    );
  });

  it("detects ORA-01017 in trace and provides a specific step", () => {
    const verification: VerificationOutcome = {
      status: "failed",
      connectorState: "RUNNING",
      taskStates: ["FAILED"],
      traceSnippet:
        "Caused by: java.sql.SQLException: ORA-01017: invalid username/password; logon denied",
    };
    const plan = buildRemediationPlan({
      phase: "verify_connector",
      errorMessage: "verify failed",
      verification,
    });
    expect(plan.steps.some((s) => /ORA-01017/.test(s.title))).toBe(true);
  });

  it("detects network errors in trace", () => {
    const verification: VerificationOutcome = {
      status: "failed",
      connectorState: "RUNNING",
      taskStates: ["FAILED"],
      traceSnippet: "java.net.UnknownHostException: appian-db.internal",
    };
    const plan = buildRemediationPlan({
      phase: "verify_connector",
      errorMessage: "verify failed",
      verification,
    });
    expect(plan.steps.some((s) => /DNS lookup/i.test(s.title))).toBe(true);
  });

  it("detects ORA-12541 listener error", () => {
    const verification: VerificationOutcome = {
      status: "failed",
      connectorState: "RUNNING",
      taskStates: ["FAILED"],
      traceSnippet: "ORA-12541: TNS:no listener",
    };
    const plan = buildRemediationPlan({
      phase: "verify_connector",
      errorMessage: "verify failed",
      verification,
    });
    expect(plan.steps.some((s) => /No listener/i.test(s.title))).toBe(true);
  });

  it("falls back to a generic inspection step when trace has no known patterns", () => {
    const verification: VerificationOutcome = {
      status: "failed",
      connectorState: "RUNNING",
      taskStates: ["FAILED"],
      traceSnippet: "some unfamiliar error trace text",
    };
    const plan = buildRemediationPlan({
      phase: "verify_connector",
      errorMessage: "verify failed",
      verification,
    });
    expect(plan.steps.some((s) => /Inspect the full/i.test(s.title))).toBe(true);
  });

  it("handles verification timeout with no trace", () => {
    const verification: VerificationOutcome = {
      status: "timeout",
      lastConnectorState: "UNASSIGNED",
      traceSnippet: undefined,
    };
    const plan = buildRemediationPlan({
      phase: "verify_connector",
      errorMessage: "timed out",
      verification,
    });
    expect(plan.summary).toMatch(/timed out/i);
    expect(plan.steps.some((s) => /Increase verification time/i.test(s.title))).toBe(true);
  });

  it("handles not_found verification outcome", () => {
    const verification: VerificationOutcome = {
      status: "not_found",
      message: "connector missing",
    };
    const plan = buildRemediationPlan({
      phase: "verify_connector",
      errorMessage: "missing",
      verification,
    });
    expect(plan.summary).toMatch(/not found/i);
    expect(plan.steps.some((s) => /configureConnectors manually/i.test(s.title))).toBe(true);
  });

  it("handles verify_connector with no verification (pre-check error)", () => {
    const plan = buildRemediationPlan({
      phase: "verify_connector",
      errorMessage: "could not reach ECS",
    });
    expect(plan.summary).toMatch(/could not run/i);
    expect(plan.steps.some((s) => /Re-trigger rotation manually/i.test(s.title))).toBe(true);
  });

  it("describes notify failures as informational", () => {
    const plan = buildRemediationPlan({ phase: "notify", errorMessage: "SES error" });
    expect(plan.summary).toMatch(/informational/i);
  });
});
