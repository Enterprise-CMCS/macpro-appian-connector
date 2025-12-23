import {
  ECSClient,
  DescribeTasksCommand,
  ListTasksCommand,
  waitUntilTasksRunning,
} from "@aws-sdk/client-ecs";

export async function findIpForEcsService(cluster: string, service: string): Promise<string | undefined> {
  const client = new ECSClient({});
  
  const listTasksResponse = await client.send(
    new ListTasksCommand({
      cluster: cluster,
      serviceName: service,
      desiredStatus: "RUNNING",
    })
  );
  
  const taskArns = listTasksResponse.taskArns;
  if (!taskArns || taskArns.length === 0) {
    console.log("No running tasks found for service");
    return undefined;
  }
  
  await waitUntilTasksRunning(
    {
      client,
      maxWaitTime: 300,
    },
    {
      cluster: cluster,
      tasks: [taskArns[0]],
    }
  );
  
  const describeTasksResponse = await client.send(
    new DescribeTasksCommand({
      cluster: cluster,
      tasks: [taskArns[0]],
    })
  );
  
  const tasks = describeTasksResponse.tasks;
  if (!tasks || tasks.length === 0) {
    console.log("No tasks found in describe response");
    return undefined;
  }
  
  const task = tasks[0];
  const attachments = task.attachments;
  if (!attachments || attachments.length === 0) {
    console.log("No attachments found on task");
    return undefined;
  }
  
  const details = attachments[0].details;
  if (!details) {
    console.log("No details found on attachment");
    return undefined;
  }
  
  const ipDetail = details.find((x) => x.name === "privateIPv4Address");
  return ipDetail?.value;
}

