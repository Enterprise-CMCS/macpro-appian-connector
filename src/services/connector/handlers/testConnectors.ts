import * as connect from "../../../libs/connect-lib";
import { getMetricSum, sendMetricData } from "../../../libs/cloudwatch-lib";
import type { ConnectorStatus } from "../../../types";
import { connectors } from "../libs/connectors";
import { classifyOracleTaskTraces, formatOracleConnectorLog } from "../libs/oracle-trace";

const RUNNING = "RUNNING";
const HEARTBEAT_METRIC = "health_check_heartbeat";
const DEFAULT_MAX_RESTARTS_PER_HOUR = 3;
const RESTART_WINDOW_MINUTES = 60;

function maxRestartsPerHour(): number {
  const parsed = Number(process.env.maxRestartsPerHour);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_RESTARTS_PER_HOUR;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function putMetric(namespace: string, metricName: string, value: number): Promise<boolean> {
  return sendMetricData({
    Namespace: namespace,
    MetricData: [{ MetricName: metricName, Value: value }],
  });
}

async function restartLimitReached(namespace: string, connectorName: string, limit: number): Promise<boolean> {
  try {
    return (await getMetricSum(namespace, `${connectorName}_restarts`, RESTART_WINDOW_MINUTES)) >= limit;
  } catch (e) {
    console.log(`Could not read restart count for ${connectorName}`, errorMessage(e));
    return true;
  }
}

// Auth and account-lock failures are never restarted: each restart is another failed Oracle login.
async function restartIfNeeded(
  cluster: string,
  service: string,
  namespace: string,
  result: ConnectorStatus,
  authFailure: boolean
): Promise<boolean> {
  const failing = result.connector.state !== RUNNING || result.tasks.some((task) => task.state !== RUNNING);
  const connector = connectors.find((item) => item.name === result.name);
  if (authFailure || !failing || !connector) {
    return false;
  }

  const limit = maxRestartsPerHour();
  if (await restartLimitReached(namespace, result.name, limit)) {
    console.log(`RESTART_CAPPED connector=${result.name} limit=${limit}`);
    return true;
  }

  const recorded = await putMetric(namespace, `${result.name}_restarts`, 1);
  if (recorded === false) {
    console.log(`Could not record restart for ${result.name}`);
    return false;
  }

  await connect.restartConnectors(cluster, service, [connector]);
  return false;
}

export const handler = async function (): Promise<void> {
  const cluster = process.env.cluster;
  const service = process.env.service;
  const namespace = process.env.namespace;

  if (!cluster || !service || !namespace) {
    throw new Error("Environment variables 'cluster', 'service', and 'namespace' are required");
  }

  try {
    const results = await connect.testConnectors(cluster, service, connectors);
    console.log(
      "Kafka connector status results",
      JSON.stringify(
        results.map(({ name, connector, tasks }) => ({
          name,
          connectorState: connector.state,
          tasks: tasks.map(({ id, state }) => ({ id, state })),
        }))
      )
    );

    const classifications = results.map((result) => ({
      result,
      oracle: classifyOracleTaskTraces(result.tasks),
    }));

    for (const { result, oracle } of classifications) {
      if (oracle.oracleClass && oracle.code) {
        console.log(formatOracleConnectorLog(result.name, oracle.code, oracle.oracleClass));
      }
    }

    await Promise.all(classifications.map(({ result }) => putMetric(namespace, `${result.name}_failures`, result.connector.state === RUNNING ? 0 : 1)));

    await Promise.all(
      classifications.map(({ result }) =>
        putMetric(namespace, `${result.name}_task_failures`, result.tasks.every((task) => task.state === RUNNING) ? 0 : 1)
      )
    );

    await Promise.all(
      classifications.map(({ result, oracle }) =>
        sendMetricData({
          Namespace: namespace,
          MetricData: [
            { MetricName: `${result.name}_oracle_auth_failures`, Value: oracle.authFailure ? 1 : 0 },
            { MetricName: `${result.name}_oracle_errors`, Value: oracle.oracleError ? 1 : 0 },
          ],
        })
      )
    );

    for (const { result, oracle } of classifications) {
      const capped = await restartIfNeeded(cluster, service, namespace, result, oracle.authFailure);
      await putMetric(namespace, `${result.name}_restart_capped`, capped ? 1 : 0);
    }
  } catch (e) {
    console.log("Error caught while testing connectors", errorMessage(e));
    await Promise.all(connectors.map((connector) => putMetric(namespace, `${connector.name}_failures`, 1)));
  } finally {
    await putMetric(namespace, HEARTBEAT_METRIC, 1);
  }
};
