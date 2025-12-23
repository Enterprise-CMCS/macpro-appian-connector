import * as cdk from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';

export interface AppianAlertsMasterStackProps extends cdk.StackProps {
}

/**
 * The AWS CloudFormation template for this Serverless application
 */
export class AppianAlertsMasterStack extends cdk.Stack {
  public readonly serverlessDeploymentBucketName;
  /**
   * ECS Failure SNS topic ARN
   */
  public readonly ecsFailureTopicArn;

  public constructor(scope: cdk.App, id: string, props: AppianAlertsMasterStackProps = {}) {
    super(scope, id, props);

    // Resources
    const kmsKeyForSns = new kms.CfnKey(this, 'KmsKeyForSns', {
      enableKeyRotation: true,
      keyPolicy: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'Allow access for Root User',
            Effect: 'Allow',
            Principal: {
              AWS: this.account,
            },
            Action: 'kms:*',
            Resource: '*',
          },
          {
            Sid: 'Allow access for Key User (SNS Service Principal)',
            Effect: 'Allow',
            Principal: {
              Service: 'sns.amazonaws.com',
            },
            Action: [
              'kms:GenerateDataKey',
              'kms:Decrypt',
            ],
            Resource: '*',
          },
          {
            Sid: 'Allow CloudWatch events to use the key',
            Effect: 'Allow',
            Principal: {
              Service: 'events.amazonaws.com',
            },
            Action: [
              'kms:Decrypt',
              'kms:GenerateDataKey',
            ],
            Resource: '*',
          },
          {
            Sid: 'Allow CloudWatch for CMK',
            Effect: 'Allow',
            Principal: {
              Service: [
                'cloudwatch.amazonaws.com',
              ],
            },
            Action: [
              'kms:Decrypt',
              'kms:GenerateDataKey*',
            ],
            Resource: '*',
          },
        ],
      },
    });

    const serverlessDeploymentBucket = new s3.CfnBucket(this, 'ServerlessDeploymentBucket', {
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          {
            serverSideEncryptionByDefault: {
              sseAlgorithm: 'AES256',
            },
          },
        ],
      },
      versioningConfiguration: {
        status: 'Enabled',
      },
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
    });

    const alertsTopic = new sns.CfnTopic(this, 'AlertsTopic', {
      topicName: 'Alerts-appian-alerts-master',
      kmsMasterKeyId: kmsKeyForSns.ref,
    });

    const serverlessDeploymentBucketPolicy = new s3.CfnBucketPolicy(this, 'ServerlessDeploymentBucketPolicy', {
      bucket: serverlessDeploymentBucket.ref,
      policyDocument: {
        Statement: [
          {
            Action: 's3:*',
            Effect: 'Deny',
            Principal: '*',
            Resource: [
              [
                'arn:',
                this.partition,
                ':s3:::',
                serverlessDeploymentBucket.ref,
                '/*',
              ].join(''),
              [
                'arn:',
                this.partition,
                ':s3:::',
                serverlessDeploymentBucket.ref,
              ].join(''),
            ],
            Condition: {
              Bool: {
                'aws:SecureTransport': false,
              },
            },
          },
        ],
      },
    });

    const eventBridgeToSnsPolicy = new sns.CfnTopicPolicy(this, 'EventBridgeToSnsPolicy', {
      policyDocument: {
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: [
                'events.amazonaws.com',
                'cloudwatch.amazonaws.com',
              ],
            },
            Action: 'sns:Publish',
            Resource: alertsTopic.ref,
          },
        ],
      },
      topics: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
    });

    // Outputs
    this.serverlessDeploymentBucketName = serverlessDeploymentBucket.ref;
    new cdk.CfnOutput(this, 'CfnOutputServerlessDeploymentBucketName', {
      key: 'ServerlessDeploymentBucketName',
      exportName: 'sls-appian-alerts-master-ServerlessDeploymentBucketName',
      value: this.serverlessDeploymentBucketName!.toString(),
    });
    this.ecsFailureTopicArn = alertsTopic.ref;
    new cdk.CfnOutput(this, 'CfnOutputECSFailureTopicArn', {
      key: 'ECSFailureTopicArn',
      description: 'ECS Failure SNS topic ARN',
      value: this.ecsFailureTopicArn!.toString(),
    });
  }
}
