import { send, SUCCESS, FAILED } from "cfn-response-async";
import * as topics from "../../../libs/topics-lib";
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationContext,
} from "../../../types";

interface CleanupKafkaProperties {
  BrokerString: string;
  TopicPatternsToDelete: string[];
}

export const handler = async function (
  event: CloudFormationCustomResourceEvent,
  context: CloudFormationContext
): Promise<void> {
  console.log("Request:", JSON.stringify(event, undefined, 2));
  const responseData = {};
  let responseStatus: typeof SUCCESS | typeof FAILED = SUCCESS;

  try {
    const properties = event.ResourceProperties as unknown as CleanupKafkaProperties;
    const BrokerString = properties.BrokerString;
    const TopicPatternsToDelete = properties.TopicPatternsToDelete;

    if (event.RequestType === "Create" || event.RequestType === "Update") {
      console.log("This resource does nothing on Create and Update events.");
    } else if (event.RequestType === "Delete") {
      console.log(
        `Attempting a delete for each of the following patterns: ${TopicPatternsToDelete}`
      );
      await topics.deleteTopics(BrokerString, TopicPatternsToDelete);
    }
  } catch (error) {
    console.error(error);
    responseStatus = FAILED;
  } finally {
    await send(event, context, responseStatus, responseData, "static");
  }
};

