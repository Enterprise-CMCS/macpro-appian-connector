import * as connect from "../../../libs/connect-lib";
import { connectors } from "../libs/connectors";

export const handler = async function (): Promise<void> {
  const cluster = process.env.cluster;
  const service = process.env.service;

  if (!cluster || !service) {
    throw new Error("Environment variables 'cluster' and 'service' are required");
  }

  await connect.putConnectors(cluster, service, connectors);
  await connect.deleteConnectors(cluster, service, []);
  await connect.restartConnectors(cluster, service, connectors);
};

