import { describe, expect, it } from "vitest";
import connectorNames from "../libs/connector-names.json";
import {
  connectors,
  smartIntegrationConnector,
  SMART_INTEGRATION_INCREMENTING_COLUMN,
  SMART_INTEGRATION_TIMESTAMP_COLUMN,
} from "../libs/connectors";
import { smartIntegrationQuery } from "../libs/query";

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

describe("staged smart integration connector", () => {
  it("is not in the deployed connectors list or connector-names.json", () => {
    expect(connectors.map((connector) => connector.name)).not.toContain(smartIntegrationConnector.name);
    expect(Object.values(connectorNames)).not.toContain(smartIntegrationConnector.name);
  });

  it("keeps tasks.max at 0 until the staged connector is confirmed", () => {
    expect(smartIntegrationConnector.config["tasks.max"]).toBe(0);
  });

  it("uses the SMART view topic name", () => {
    expect(String(smartIntegrationConnector.config["topic.prefix"])).toContain(
      "aws.appian.cmcs.MCP_SMART_INTEGRATION_VW"
    );
    expect(smartIntegrationConnector.config["topic.prefix"]).toBe(
      `${process.env.topicNamespace}aws.appian.cmcs.MCP_SMART_INTEGRATION_VW`
    );
  });

  it("reads MCP_SMART_INTEGRATION_VW from legacyschema", () => {
    expect(smartIntegrationQuery).toMatch(/FROM .+\.MCP_SMART_INTEGRATION_VW/);
    expect(smartIntegrationConnector.config.query).toBe(smartIntegrationQuery);
  });

  it("reuses the existing JDBC connection settings", () => {
    const existing = connectors[0].config;
    expect(smartIntegrationConnector.config["connection.attempts"]).toBe(1);
    expect(smartIntegrationConnector.config["connector.class"]).toBe(existing["connector.class"]);
    expect(smartIntegrationConnector.config["connection.user"]).toBe(existing["connection.user"]);
    expect(smartIntegrationConnector.config["connection.password"]).toBe(existing["connection.password"]);
    expect(smartIntegrationConnector.config["connection.url"]).toBe(existing["connection.url"]);
    expect(smartIntegrationConnector.config["poll.interval.ms"]).toBe(existing["poll.interval.ms"]);
    expect(smartIntegrationConnector.config.mode).toBe("timestamp+incrementing");
  });

  it("keys messages by SPA_PCKG_ID for partition ordering", () => {
    expect(smartIntegrationConnector.config.transforms).toBe("createKey,extractKey");
    expect(smartIntegrationConnector.config["transforms.createKey.type"]).toBe(
      "org.apache.kafka.connect.transforms.ValueToKey"
    );
    expect(smartIntegrationConnector.config["transforms.createKey.fields"]).toBe("SPA_PCKG_ID");
    expect(smartIntegrationConnector.config["transforms.extractKey.type"]).toBe(
      "org.apache.kafka.connect.transforms.ExtractField$Key"
    );
    expect(smartIntegrationConnector.config["transforms.extractKey.field"]).toBe("SPA_PCKG_ID");
  });

  it("uses pending Database change-tracking column names", () => {
    expect(smartIntegrationConnector.config["incrementing.column.name"]).toBe(
      SMART_INTEGRATION_INCREMENTING_COLUMN
    );
    expect(smartIntegrationConnector.config["timestamp.column.name"]).toBe(SMART_INTEGRATION_TIMESTAMP_COLUMN);
  });
});
