import * as topics from "../../../libs/topics-lib.js";
const topicList = [
  {
    topic: `aws.appian.cdc`,
    numPartitions: 1,
    replicationFactor: 3,
  },
];

exports.handler = async function (event, context, callback) {
  console.log("Received event:", JSON.stringify(event, null, 2));
  await topics.createTopics(
    process.env.brokerString,
    process.env.topicNamespace,
    topicList
  );
};
