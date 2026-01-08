import { SecretsManager } from 'aws-sdk';

/**
 * Secret path patterns for AWS Secrets Manager.
 * These follow the pattern established by the original Serverless Framework configuration.
 * Secrets use a fallback pattern: appian/{stage}/... -> appian/default/...
 */
export const SecretPaths = {
  vpc: (stage: string) => `appian/${stage}/vpc`,
  vpcDefault: 'appian/default/vpc',
  brokerString: (stage: string) => `appian/${stage}/brokerString`,
  brokerStringDefault: 'appian/default/brokerString',
  dbInfo: (stage: string) => `appian/${stage}/dbInfo`,
  dbInfoDefault: 'appian/default/dbInfo',
  iamPath: (stage: string) => `appian/${stage}/iam/path`,
  iamPathDefault: 'appian/default/iam/path',
  iamPermissionsBoundary: (stage: string) => `appian/${stage}/iam/permissionsBoundary`,
  iamPermissionsBoundaryDefault: 'appian/default/iam/permissionsBoundary',
  ecrImage: 'ecr/images/appian/appian-connector',
} as const;

/**
 * VPC configuration structure from Secrets Manager
 */
export interface VpcConfig {
  id: string;
  dataSubnets: string[];
  privateSubnets: string[];
  publicSubnets: string[];
}

/**
 * Database configuration structure from Secrets Manager
 */
export interface DbConfig {
  ip: string;
  port: string;
  db: string;
  user: string;
  password: string;
  schema: string;
}

/**
 * Environment-specific configuration for ECS Fargate resources.
 * Values are based on currently deployed CloudFormation stacks.
 */
export interface EnvironmentConfig {
  stage: string;
  // Task-level CPU (string format for CloudFormation)
  taskCpu: string;
  // Task-level memory (string format for CloudFormation)
  taskMemory: string;
  // Connect container CPU
  connectContainerCpu: number;
  // Connect container memory
  connectContainerMemory: number;
  // Instantclient container memory
  instantClientContainerMemory: number;
}

/**
 * Full environment configuration including secrets.
 * Secrets are resolved at synth-time from AWS Secrets Manager.
 */
export interface FullEnvironmentConfig extends EnvironmentConfig {
  vpc: VpcConfig;
  brokerString: string;
  dbInfo: DbConfig;
  iamPath: string;
  iamPermissionsBoundary: string;
  ecrImage: string;
}

/**
 * Environment configurations for ECS resources (non-secret values).
 * These values were retrieved from deployed CloudFormation stacks
 * to ensure CDK migration does not alter existing resources.
 */
export const environmentConfigs: Record<string, EnvironmentConfig> = {
  master: {
    stage: 'master',
    taskCpu: '1024',
    taskMemory: '2048',
    connectContainerCpu: 512,
    connectContainerMemory: 1024,
    instantClientContainerMemory: 512,
  },
  val: {
    stage: 'val',
    taskCpu: '1024',
    taskMemory: '3072',
    connectContainerCpu: 512,
    connectContainerMemory: 2560,
    instantClientContainerMemory: 512,
  },
  production: {
    stage: 'production',
    taskCpu: '2048',
    taskMemory: '6144',
    connectContainerCpu: 2048,
    connectContainerMemory: 4096,
    instantClientContainerMemory: 2048,
  },
};

/**
 * Get environment configuration for a given stage.
 * Falls back to master configuration if stage is not found.
 */
export function getEnvironmentConfig(stage: string): EnvironmentConfig {
  return environmentConfigs[stage] || environmentConfigs.master;
}

/**
 * Fetch a secret value from AWS Secrets Manager synchronously.
 * This is used at synth-time to resolve secrets.
 */
async function getSecretValue(secretId: string): Promise<string> {
  const client = new SecretsManager({ region: process.env.AWS_REGION || 'us-east-1' });
  const response = await client.getSecretValue({ SecretId: secretId }).promise();
  if (response.SecretString) {
    return response.SecretString;
  }
  throw new Error(`Secret ${secretId} not found or is binary`);
}

/**
 * Try to get a secret with fallback to default.
 */
async function getSecretWithFallback(primarySecretId: string, fallbackSecretId: string): Promise<string> {
  try {
    return await getSecretValue(primarySecretId);
  } catch (error) {
    // Fallback to default secret
    return await getSecretValue(fallbackSecretId);
  }
}

/**
 * Load all secrets for an environment.
 * Uses the fallback pattern: appian/{stage}/... -> appian/default/...
 */
export async function loadEnvironmentSecrets(stage: string): Promise<{
  vpc: VpcConfig;
  brokerString: string;
  dbInfo: DbConfig;
  iamPath: string;
  iamPermissionsBoundary: string;
  ecrImage: string;
}> {
  const [vpcJson, brokerString, dbInfoJson, iamPath, iamPermissionsBoundary, ecrImage] = await Promise.all([
    getSecretWithFallback(SecretPaths.vpc(stage), SecretPaths.vpcDefault),
    getSecretWithFallback(SecretPaths.brokerString(stage), SecretPaths.brokerStringDefault),
    getSecretWithFallback(SecretPaths.dbInfo(stage), SecretPaths.dbInfoDefault),
    getSecretWithFallback(SecretPaths.iamPath(stage), SecretPaths.iamPathDefault),
    getSecretWithFallback(SecretPaths.iamPermissionsBoundary(stage), SecretPaths.iamPermissionsBoundaryDefault),
    getSecretValue(SecretPaths.ecrImage),
  ]);

  return {
    vpc: JSON.parse(vpcJson) as VpcConfig,
    brokerString,
    dbInfo: JSON.parse(dbInfoJson) as DbConfig,
    iamPath,
    iamPermissionsBoundary,
    ecrImage,
  };
}

/**
 * Get full environment configuration including secrets.
 * This combines the static ECS config with secrets from AWS Secrets Manager.
 */
export async function getFullEnvironmentConfig(stage: string): Promise<FullEnvironmentConfig> {
  const baseConfig = getEnvironmentConfig(stage);
  const secrets = await loadEnvironmentSecrets(stage);
  
  return {
    ...baseConfig,
    ...secrets,
  };
}
