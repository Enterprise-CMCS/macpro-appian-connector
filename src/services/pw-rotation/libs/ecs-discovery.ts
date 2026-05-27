import {
  DescribeTasksCommand,
  ListTasksCommand,
  type ECSClient,
} from "@aws-sdk/client-ecs";

export class WorkerNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WorkerNotFoundError";
  }
}

export async function findKafkaConnectWorkerIp(
  client: ECSClient,
  cluster: string,
  service: string,
): Promise<string> {
  const listResponse = await client.send(
    new ListTasksCommand({
      cluster,
      serviceName: service,
      desiredStatus: "RUNNING",
    }),
  );

  const taskArns = listResponse.taskArns ?? [];
  if (taskArns.length === 0) {
    throw new WorkerNotFoundError(
      `No RUNNING tasks found for ECS service ${service} in cluster ${cluster}`,
    );
  }

  const describeResponse = await client.send(
    new DescribeTasksCommand({ cluster, tasks: [taskArns[0]] }),
  );
  const task = describeResponse.tasks?.[0];
  const detail = task?.attachments?.[0]?.details?.find(
    (d) => d.name === "privateIPv4Address",
  );
  if (!detail?.value) {
    throw new WorkerNotFoundError(
      `Could not resolve privateIPv4Address for ECS task in service ${service}`,
    );
  }
  return detail.value;
}
