import * as connect from "../../../libs/connect-lib";
import { connectors } from "../libs/connectors";
import { classifyOracleTaskTraces, formatOracleConnectorLog } from "../libs/oracle-trace";

export const handler = async function (): Promise<void> {
  const cluster = process.env.cluster;
  const service = process.env.service;

  if (!cluster || !service) {
    throw new Error("Environment variables 'cluster' and 'service' are required");
  }

  await connect.putConnectors(cluster, service, connectors);
  await connect.deleteConnectors(cluster, service, []);

  const statuses = await connect.testConnectors(cluster, service, connectors);
  for (const status of statuses) {
    const classification = classifyOracleTaskTraces(status.tasks);
    if (classification.oracleClass === "auth" && classification.code) {
      const line = formatOracleConnectorLog(status.name, classification.code, classification.oracleClass);
      console.log(line);
      throw new Error(line);
    }
  }

  await connect.restartConnectors(cluster, service, connectors);
};
