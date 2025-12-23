/**
 * Shared TypeScript type definitions for the Appian Connector
 */

// ============================================================================
// CloudFormation Custom Resource Types
// ============================================================================

export interface CloudFormationCustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ServiceToken: string;
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  ResourceType: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: Record<string, unknown>;
  OldResourceProperties?: Record<string, unknown>;
}

export interface CloudFormationContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  getRemainingTimeInMillis(): number;
  done(error?: Error, result?: unknown): void;
  fail(error: Error | string): void;
  succeed(messageOrObject: unknown): void;
}

// ============================================================================
// Kafka Topic Types
// ============================================================================

export interface TopicConfig {
  topic: string;
  numPartitions: number;
  replicationFactor: number;
}

export interface TopicToCreate {
  name: string;
  numPartitions?: number;
  replicationFactor?: number;
}

// ============================================================================
// Kafka Connect Types
// ============================================================================

export interface ConnectorConfig {
  name: string;
  config: Record<string, string | number | boolean>;
}

export interface ConnectorStatus {
  name: string;
  connector: {
    state: string;
    worker_id: string;
  };
  tasks: Array<{
    id: number;
    state: string;
    worker_id: string;
  }>;
  type: string;
}

export interface HttpRequestParams {
  hostname: string;
  port?: number;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

// ============================================================================
// CloudWatch Types
// ============================================================================

export interface MetricData {
  MetricName: string;
  Value: number;
  Unit?: string;
  Dimensions?: Array<{
    Name: string;
    Value: string;
  }>;
}

export interface PutMetricDataParams {
  Namespace: string;
  MetricData: MetricData[];
}

// ============================================================================
// ECS Types
// ============================================================================

export interface EcsTaskInfo {
  taskArns: string[];
  tasks: Array<{
    attachments: Array<{
      details: Array<{
        name: string;
        value: string;
      }>;
    }>;
  }>;
}

// ============================================================================
// Lambda Handler Types
// ============================================================================

export type LambdaHandler<TEvent = unknown, TResult = unknown> = (
  event: TEvent,
  context: CloudFormationContext
) => Promise<TResult>;

// ============================================================================
// Environment Variables
// ============================================================================

export interface ConnectorEnvironment {
  cluster: string;
  service: string;
  namespace: string;
  topicNamespace: string;
  legacydbIp: string;
  legacydbPort: string;
  legacyDb: string;
  legacydbUser: string;
  legacydbPassword: string;
  legacyschema: string;
}

