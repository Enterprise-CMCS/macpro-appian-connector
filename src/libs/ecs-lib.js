var _ = require("lodash");
import {
  ECSClient,
  DescribeTasksCommand,
  ListTasksCommand,
  waitUntilTasksRunning,
} from "@aws-sdk/client-ecs";

export async function findIpForEcsService(cluster, service) {
  const client = new ECSClient({
    cluster: cluster,
  });
  const listStacksCommandResponse = await client.send(
    new ListTasksCommand({
      cluster: cluster,
      desiredStatus: "RUNNING",
    })
  );
  const taskArns = listStacksCommandResponse.taskArns;
  if (taskArns.length == 0) {
    console.log("NEED ERROR HANDLING");
    return;
  }
  waitUntilTasksRunning({
    cluster: cluster,
    tasks: [taskArns[0]],
  });
  const describeTasksCommandResponse = await client.send(
    new DescribeTasksCommand({
      cluster: cluster,
      tasks: [taskArns[0]],
    })
  );
  const task = describeTasksCommandResponse.tasks[0];
  const ip = _.filter(
    task.attachments[0].details,
    (x) => x.name === "privateIPv4Address"
  )[0].value;
  return ip;
}
