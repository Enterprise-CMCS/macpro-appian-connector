import { send, SUCCESS, FAILED } from "cfn-response-async";
import * as topics from "../../../libs/topics-lib";
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationContext,
  TopicToCreate,
  TopicConfig,
} from "../../../types";

interface CreateTopicsProperties {
  TopicsToCreate: TopicToCreate[];
  BrokerString: string;
}

export const handler = async function (
  event: CloudFormationCustomResourceEvent,
  context: CloudFormationContext
): Promise<void> {
  console.log("Request:", JSON.stringify(event, undefined, 2));
  const responseData = {};
  let responseStatus: typeof SUCCESS | typeof FAILED = SUCCESS;

  try {
    const properties = event.ResourceProperties as unknown as CreateTopicsProperties;
    const TopicsToCreate = properties.TopicsToCreate;
    const BrokerString = properties.BrokerString;

    const topicConfig: TopicConfig[] = TopicsToCreate.map((element) => {
      const topic = element.name;
      const replicationFactor = element.replicationFactor || 3;
      const numPartitions = element.numPartitions || 1;

      if (!topic) {
        throw new Error(
          "Invalid configuration for TopicsToCreate. All entries must have a 'name' key with a string value."
        );
      }
      if (replicationFactor < 3) {
        throw new Error(
          "Invalid configuration for TopicsToCreate. If specified, replicationFactor must be greater than or equal to 3."
        );
      }
      if (numPartitions < 1) {
        throw new Error(
          "Invalid configuration for TopicsToCreate. If specified, numPartitions must be greater than or equal to 1."
        );
      }

      return {
        topic,
        numPartitions,
        replicationFactor,
      };
    });

    console.log(JSON.stringify(topicConfig, null, 2));

    if (event.RequestType === "Create" || event.RequestType === "Update") {
      await topics.createTopics(BrokerString, topicConfig);
    } else if (event.RequestType === "Delete") {
      console.log("This resource does nothing on Delete events.");
    }
  } catch (error) {
    console.error(error);
    responseStatus = FAILED;
  } finally {
    await send(event, context, responseStatus, responseData, "static");
  }
};

