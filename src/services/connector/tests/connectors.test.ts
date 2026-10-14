import { describe, expect, it } from "vitest";
import connectorNames from "../libs/connector-names.json";
import { connectors } from "../libs/connectors";

describe("connector names", () => {
  it("defines exactly one connector config per name in connector-names.json", () => {
    expect(connectors.map((connector) => connector.name).sort()).toEqual(Object.values(connectorNames).sort());
  });

  it("keeps the live connector name", () => {
    expect(connectorNames.appianDbo).toBe("source.jdbc.appian-connector-dbo-1");
  });

  it("makes one login attempt per task start", () => {
    for (const connector of connectors) {
      expect(connector.config["connection.attempts"]).toBe(1);
    }
  });
});
