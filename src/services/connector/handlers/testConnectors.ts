import * as connect from "../../../libs/connect-lib";
import { sendMetricData } from "../../../libs/cloudwatch-lib";
import { connectors } from "../libs/connectors";

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
    console.log("Kafka connector status results", JSON.stringify(results));

    // Send a metric for each connector status - 0 = success or 1 = failure
    await Promise.all(
      results.map(({ name, connector }) => {
        return sendMetricData({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: `${name}_failures`,
              Value: connector.state === RUNNING ? 0 : 1,
            },
          ],
        });
      })
    );

    // Send a metric for connector tasks status.
    // 0 = all tasks for a connector are running or 1 = some tasks for a connector failed
    await Promise.all(
      results.map(({ name, tasks }) => {
        const tasksRunning = tasks.every((task) => task.state === RUNNING);
        return sendMetricData({
          Namespace: namespace,
          MetricData: [
            {
              MetricName: `${name}_task_failures`,
              Value: tasksRunning ? 0 : 1,
            },
          ],
        });
      })
    );

    // Get any failing results
    const failingResults = results.filter(({ tasks, connector }) => {
      return (
        connector.state !== RUNNING ||
        tasks.some((task) => task.state !== RUNNING)
      );
    });

    // If any of the results failed, restart only the failing connectors/tasks
    if (failingResults.length > 0) {
      const connectorsToRestart = connectors.filter((connector) =>
        failingResults.some((result) => result.name === connector.name)
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

