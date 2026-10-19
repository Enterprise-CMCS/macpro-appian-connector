import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  PutMetricDataCommand,
  PutMetricDataCommandInput,
} from "@aws-sdk/client-cloudwatch";

export async function sendMetricData(params: PutMetricDataCommandInput): Promise<boolean> {
  console.log("Sending metric data: ", JSON.stringify(params));
  const client = new CloudWatchClient({});
  const command = new PutMetricDataCommand(params);
  try {
    const response = await client.send(command);
    console.log("Response from sending metric data", JSON.stringify(response));
    return true;
  } catch (e) {
    console.log("Error from sending metric data", e);
    return false;
  }
}

export async function getMetricSum(namespace: string, metricName: string, minutes: number): Promise<number> {
  const client = new CloudWatchClient({});
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - minutes * 60_000);
  const response = await client.send(
    new GetMetricStatisticsCommand({
      Namespace: namespace,
      MetricName: metricName,
      StartTime: startTime,
      EndTime: endTime,
      Period: 60,
      Statistics: ["Sum"],
    })
  );
  return (response.Datapoints ?? []).reduce((total, point) => total + (point.Sum ?? 0), 0);
}
