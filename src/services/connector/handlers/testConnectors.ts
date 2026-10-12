import * as connect from "../../../libs/connect-lib";
import { sendMetricData } from "../../../libs/cloudwatch-lib";
import { connectors } from "../libs/connectors";
import { classifyOracleTaskTraces, formatOracleConnectorLog } from "../libs/oracle-trace";

const RUNNING = "RUNNING";

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

    // Send a metric for each connector status - 0 = success or 1 = failure
    await Promise.all(
      classifications.map(({ result }) => {
        return sendMetricData({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: `${result.name}_failures`,
              Value: result.connector.state === RUNNING ? 0 : 1,
            },
          ],
        });
      })
    );

    // Send a metric for connector tasks status.
    // 0 = all tasks for a connector are running or 1 = some tasks for a connector failed
    await Promise.all(
      classifications.map(({ result }) => {
        const tasksRunning = result.tasks.every((task) => task.state === RUNNING);
        return sendMetricData({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: `${result.name}_task_failures`,
              Value: tasksRunning ? 0 : 1,
            },
          ],
        });
      })
    );

    await Promise.all(
      classifications.map(({ result, oracle }) => {
        return sendMetricData({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: `${result.name}_oracle_auth_failures`,
              Value: oracle.authFailure ? 1 : 0,
            },
            {
              MetricName: `${result.name}_oracle_errors`,
              Value: oracle.oracleError ? 1 : 0,
            },
          ],
        });
      })
    );

    // Auth and account-lock failures must not be restarted. Other failures keep the existing restart rule.
    const failingResults = classifications.filter(({ result, oracle }) => {
      if (oracle.authFailure) {
        return false;
      }
      return result.connector.state !== RUNNING || result.tasks.some((task) => task.state !== RUNNING);
    });

    if (failingResults.length > 0) {
      const connectorsToRestart = connectors.filter((connector) =>
        failingResults.some(({ result }) => result.name === connector.name)
      );

      await connect.restartConnectors(cluster, service, connectorsToRestart);
    }
  } catch (e) {
    console.log("Error caught while testing connectors", JSON.stringify(e));

    // For unknown errors send a metric value for each connector indicating failure
    await Promise.all(
      connectors.map((connector) => {
        return sendMetricData({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: `${connector.name}_failures`,
              Value: 1,
            },
          ],
        });
      })
    );
  }
};
