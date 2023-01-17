import * as topics from "../../../libs/topics-lib.js";
const topicList = [
  {
    topic: `aws.mmdl.cdc.PLAN_BASE_WVR_TBL`,
    numPartitions: 1,
    replicationFactor: 3,
  },
  {
    topic: `aws.mmdl.cdc.PLAN_WVR_FLD_MPNG_TBL`,
    numPartitions: 1,
    replicationFactor: 3,
  },
  {
    topic: `aws.mmdl.cdc.PLAN_WVR_RVSN_TBL`,
    numPartitions: 1,
    replicationFactor: 3,
  },
  {
    topic: `aws.mmdl.cdc.PLAN_WVR_RVSN_VRSN_TBL`,
    numPartitions: 1,
    replicationFactor: 3,
  },
  {
    topic: `aws.mmdl.cdc.GEO_US_STATE_TBL`,
    numPartitions: 1,
    replicationFactor: 3,
  },
  {
    topic: `aws.mmdl.cdc.PLAN_WVR_VRSN_DTL_TBL`,
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
