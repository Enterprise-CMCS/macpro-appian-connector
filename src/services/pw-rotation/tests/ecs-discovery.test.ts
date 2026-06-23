import { afterEach, describe, expect, it } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DescribeTasksCommand,
  ECSClient,
  ListTasksCommand,
} from "@aws-sdk/client-ecs";

import {
  WorkerNotFoundError,
  findKafkaConnectWorkerIp,
} from "../libs/ecs-discovery";

const ecs = mockClient(ECSClient);

afterEach(() => ecs.reset());

describe("findKafkaConnectWorkerIp", () => {
  it("returns the privateIPv4Address from the first task", async () => {
    ecs.on(ListTasksCommand).resolves({ taskArns: ["arn:task:1"] });
    ecs.on(DescribeTasksCommand).resolves({
      tasks: [
        {
          attachments: [
            {
              details: [
                { name: "subnetId", value: "subnet-abc" },
                { name: "privateIPv4Address", value: "10.0.0.123" },
              ],
            },
          ],
        },
      ],
    });
    const ip = await findKafkaConnectWorkerIp(new ECSClient({}), "cluster", "service");
    expect(ip).toBe("10.0.0.123");
  });

  it("throws when no tasks are listed", async () => {
    ecs.on(ListTasksCommand).resolves({ taskArns: [] });
    await expect(
      findKafkaConnectWorkerIp(new ECSClient({}), "cluster", "service"),
    ).rejects.toBeInstanceOf(WorkerNotFoundError);
  });

  it("throws when no privateIPv4Address detail present", async () => {
    ecs.on(ListTasksCommand).resolves({ taskArns: ["arn:task:1"] });
    ecs.on(DescribeTasksCommand).resolves({
      tasks: [{ attachments: [{ details: [{ name: "subnetId", value: "subnet-abc" }] }] }],
    });
    await expect(
      findKafkaConnectWorkerIp(new ECSClient({}), "cluster", "service"),
    ).rejects.toThrow(/privateIPv4Address/);
  });
});
