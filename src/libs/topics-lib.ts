import { Kafka, ResourceTypes, ITopicConfig, ITopicMetadata } from "kafkajs";
import type { TopicConfig } from "../types";

export async function createTopics(brokerString: string, topicsConfig: TopicConfig[]): Promise<void> {
  const topics = topicsConfig;
  const brokers = brokerString.split(",");

  const kafka = new Kafka({
    clientId: "admin",
    brokers: brokers,
    ssl: true,
  });
  const admin = kafka.admin();

  const create = async (): Promise<void> => {
    await admin.connect();

    // Fetch topics from MSK and filter out __ internal management topic
    const allTopics = await admin.listTopics();
    const existingTopicList = allTopics.filter((n) => !n.startsWith("_"));

    console.log("Existing topics:", JSON.stringify(existingTopicList, null, 2));

    // Fetch the metadata for the topics in MSK
    const topicsMetadataResult = await admin.fetchTopicMetadata({ topics: existingTopicList });
    const topicsMetadata: ITopicMetadata[] = topicsMetadataResult.topics || [];
    console.log("Topics Metadata:", JSON.stringify(topicsMetadata, null, 2));

    // Diff the existing topics array with the topic configuration collection
    const topicsToCreate = topics.filter(
      (topicConfig) => !existingTopicList.includes(topicConfig.topic)
    );

    // Find intersection of topics metadata collection with topic configuration collection
    // where partition count of topic in Kafka is less than what is specified in the topic configuration collection
    // ...can't remove partitions, only add them
    const topicsToUpdate = topics.filter((topicConfig) => {
      const metadata = topicsMetadata.find((m) => m.name === topicConfig.topic);
      return metadata && topicConfig.numPartitions > (metadata.partitions?.length || 0);
    });

    // Create a collection to update topic partitioning
    const partitionConfig = topicsToUpdate.map((topic) => ({
      topic: topic.topic,
      count: topic.numPartitions,
    }));

    // Create a collection to allow querying of topic configuration
    const configOptions = topicsMetadata.map((topic) => ({
      name: topic.name,
      type: ResourceTypes.TOPIC,
    }));

    // Query topic configuration
    const configs =
      configOptions.length !== 0
        ? await admin.describeConfigs({ resources: configOptions, includeSynonyms: false })
        : [];

    console.log("Topics to Create:", JSON.stringify(topicsToCreate, null, 2));
    console.log("Topics to Update:", JSON.stringify(topicsToUpdate, null, 2));
    console.log("Partitions to Update:", JSON.stringify(partitionConfig, null, 2));
    console.log("Topic configuration options:", JSON.stringify(configs, null, 2));

    // Create topics that don't exist in MSK
    const kafkaTopicsToCreate: ITopicConfig[] = topicsToCreate.map((t) => ({
      topic: t.topic,
      numPartitions: t.numPartitions,
      replicationFactor: t.replicationFactor,
    }));
    
    if (kafkaTopicsToCreate.length > 0) {
      await admin.createTopics({ topics: kafkaTopicsToCreate });
    }

    // If any topics have less partitions in MSK than in the configuration, add those partitions
    if (partitionConfig.length > 0) {
      await admin.createPartitions({ topicPartitions: partitionConfig });
    }

    await admin.disconnect();
  };

  await create();
}

export async function deleteTopics(brokerString: string, topicPatterns: string[]): Promise<void> {
  // Check that each topic pattern is something we can safely delete
  for (const pattern of topicPatterns) {
    if (!pattern.match(/.*--.*--.*--.*/g) && !pattern.includes("*")) {
      throw new Error(
        "ERROR: The deleteTopics function only operates against topics that match /.*--.*--.*--.*/g or contain wildcards"
      );
    }
  }

  const brokers = brokerString.split(",");

  const kafka = new Kafka({
    clientId: "admin",
    brokers: brokers,
    ssl: true,
    requestTimeout: 295000, // 5s short of the lambda function's timeout
  });
  const admin = kafka.admin();

  await admin.connect();

  const currentTopics = await admin.listTopics();

  const topicsToDelete = currentTopics.filter((currentTopic) => {
    return topicPatterns.some((pattern) => {
      // Convert glob pattern to regex
      const regexPattern = pattern.replace(/\*/g, ".*");
      return !!currentTopic.match(new RegExp(regexPattern));
    });
  });

  console.log(`Deleting topics: ${topicsToDelete}`);
  await admin.deleteTopics({
    topics: topicsToDelete,
    timeout: 295000,
  });

  await admin.disconnect();
}

