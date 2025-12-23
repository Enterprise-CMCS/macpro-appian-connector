import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface AppianConnectorMasterStackProps extends cdk.StackProps {
}

/**
 * The AWS CloudFormation template for this Serverless application
 */
export class AppianConnectorMasterStack extends cdk.Stack {
  public readonly serverlessDeploymentBucketName;
  /**
   * Current Lambda function version
   */
  public readonly createTopicsLambdaFunctionQualifiedArn;
  /**
   * Current Lambda function version
   */
  public readonly configureConnectorsLambdaFunctionQualifiedArn;
  /**
   * Current Lambda function version
   */
  public readonly cleanupKafkaLambdaFunctionQualifiedArn;
  /**
   * Current Lambda function version
   */
  public readonly testConnectorsLambdaFunctionQualifiedArn;
  /**
   * The ID of the security group attached to the Kafka Connect cluster tasks.
   * This can be used by other resources to attach additional ingress rules.

   */
  public readonly kafkaConnectWorkerSecurityGroupId;

  public constructor(scope: cdk.App, id: string, props: AppianConnectorMasterStackProps = {}) {
    super(scope, id, props);

    // Resources
    const cleanupKafkaLogGroup = new logs.CfnLogGroup(this, 'CleanupKafkaLogGroup', {
      logGroupName: '/aws/lambda/appian-connector-master-cleanupKafka',
    });

    const configureConnectorsLogGroup = new logs.CfnLogGroup(this, 'ConfigureConnectorsLogGroup', {
      logGroupName: '/aws/lambda/appian-connector-master-configureConnectors',
    });

    const connectorLogsErrorCountAlarm = new cloudwatch.CfnAlarm(this, 'ConnectorLogsErrorCountAlarm', {
      datapointsToAlarm: 1,
      alarmActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
      alarmName: 'appian-connector-master-ConnectorLogsErrorCount',
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      evaluationPeriods: 2,
      period: 300,
      threshold: 1,
      metricName: 'ConnectorLogsErrorCount',
      namespace: 'appian-connector-master/Connector/ERRORS',
      statistic: 'Sum',
    });

    const connectorLogsWarnCountAlarm = new cloudwatch.CfnAlarm(this, 'ConnectorLogsWarnCountAlarm', {
      datapointsToAlarm: 1,
      alarmActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
      alarmName: 'appian-connector-master-ConnectorLogsWarnCount',
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      evaluationPeriods: 2,
      period: 300,
      threshold: 3,
      metricName: 'ConnectorLogsWarnCount',
      namespace: 'appian-connector-master/Connector/WARNS',
      statistic: 'Sum',
    });

    const createTopicsLogGroup = new logs.CfnLogGroup(this, 'CreateTopicsLogGroup', {
      logGroupName: '/aws/lambda/appian-connector-master-createTopics',
    });

    const iamRoleLambdaExecution = new iam.CfnRole(this, 'IamRoleLambdaExecution', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: [
                'lambda.amazonaws.com',
              ],
            },
            Action: [
              'sts:AssumeRole',
            ],
          },
        ],
      },
      policies: [
        {
          policyName: [
            'appian-connector',
            'master',
            'lambda',
          ].join('-'),
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'logs:CreateLogStream',
                  'logs:CreateLogGroup',
                  'logs:TagResource',
                ],
                Resource: [
                  `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/appian-connector-master*:*`,
                ],
              },
              {
                Effect: 'Allow',
                Action: [
                  'logs:PutLogEvents',
                ],
                Resource: [
                  `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/appian-connector-master*:*:*`,
                ],
              },
              {
                Effect: 'Allow',
                Action: [
                  'ec2:CreateNetworkInterface',
                  'ec2:DeleteNetworkInterface',
                  'ec2:DetachNetworkInterface',
                  'ec2:DescribeNetworkInterfaces',
                  'ec2:DescribeSecurityGroups',
                  'ec2:DescribeSubnets',
                  'ec2:DescribeVpcs',
                ],
                Resource: '*',
              },
              {
                Effect: 'Allow',
                Action: [
                  'ecs:ListTasks',
                  'ecs:DescribeTasks',
                ],
                Resource: '*',
              },
              {
                Effect: 'Allow',
                Action: [
                  'cloudwatch:PutMetricData',
                ],
                Resource: '*',
              },
            ],
          },
        },
      ],
      path: '/delegatedadmin/developer/',
      roleName: [
        'appian-connector',
        'master',
        this.region,
        'lambdaRole',
      ].join('-'),
      permissionsBoundary: 'arn:aws:iam::677829493285:policy/cms-cloud-admin/developer-boundary-policy',
      managedPolicyArns: [
        [
          'arn:',
          this.partition,
          ':iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
        ].join(''),
      ],
    });

    const jdbcConnectorAlarm = new cloudwatch.CfnAlarm(this, 'JdbcConnectorAlarm', {
      alarmActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      datapointsToAlarm: 2,
      evaluationPeriods: 5,
      metricName: 'source.jdbc.appian-dbo-1_failures',
      namespace: 'appian-connector-master',
      period: 60,
      statistic: 'Sum',
      threshold: 1,
    });

    const jdbcTaskAlarm = new cloudwatch.CfnAlarm(this, 'JdbcTaskAlarm', {
      alarmActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      datapointsToAlarm: 2,
      evaluationPeriods: 5,
      metricName: 'source.jdbc.appian-dbo-1_task_failures',
      namespace: 'appian-connector-master',
      period: 60,
      statistic: 'Sum',
      threshold: 1,
    });

    const kafkaConnectCluster = new ecs.CfnCluster(this, 'KafkaConnectCluster', {
      clusterName: 'appian-connector-master-connect',
      clusterSettings: [
        {
          name: 'containerInsights',
          value: 'enabled',
        },
      ],
    });

    const kafkaConnectWorkerLogGroup = new logs.CfnLogGroup(this, 'KafkaConnectWorkerLogGroup', {
      logGroupName: '/aws/fargate/appian-connector-master-kafka-connect',
    });

    const kafkaConnectWorkerRole = new iam.CfnRole(this, 'KafkaConnectWorkerRole', {
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: [
                'ecs.amazonaws.com',
                'ecs-tasks.amazonaws.com',
              ],
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
      ],
      policies: [
        {
          policyName: 'LambdaRolePolicy',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'ssmmessages:CreateControlChannel',
                  'ssmmessages:CreateDataChannel',
                  'ssmmessages:OpenControlChannel',
                  'ssmmessages:OpenDataChannel',
                ],
                Resource: '*',
              },
              {
                Effect: 'Allow',
                Action: [
                  'ecr:BatchGetImage',
                ],
                Resource: `arn:aws:ecr:us-east-1:${this.account}:repository/*`,
              },
            ],
          },
        },
      ],
      path: '/delegatedadmin/developer/',
      permissionsBoundary: 'arn:aws:iam::677829493285:policy/cms-cloud-admin/developer-boundary-policy',
    });

    const kafkaConnectWorkerSecurityGroup = new ec2.CfnSecurityGroup(this, 'KafkaConnectWorkerSecurityGroup', {
      groupDescription: 'Security Group for the Fargate Connect Workers.',
      vpcId: 'vpc-06eef0c4d8f259d8f',
    });

    const lambdaConfigureConnectorsSecurityGroup = new ec2.CfnSecurityGroup(this, 'LambdaConfigureConnectorsSecurityGroup', {
      groupDescription: 'Security Group for configuring the connector.',
      vpcId: 'vpc-06eef0c4d8f259d8f',
    });

    const lambdaSecurityGroup = new ec2.CfnSecurityGroup(this, 'LambdaSecurityGroup', {
      groupDescription: 'Security Group for the topics lambda function',
      vpcId: 'vpc-06eef0c4d8f259d8f',
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

    const testConnectorsLogGroup = new logs.CfnLogGroup(this, 'TestConnectorsLogGroup', {
      logGroupName: '/aws/lambda/appian-connector-master-testConnectors',
    });

    const cleanupKafkaLambdaFunction = new lambda.CfnFunction(this, 'CleanupKafkaLambdaFunction', {
      code: {
        s3Bucket: serverlessDeploymentBucket.ref,
        s3Key: 'serverless/appian-connector/master/1758423126062-2025-09-21T02:52:06.062Z/cleanupKafka.zip',
      },
      handler: 'handlers/cleanupKafka.handler',
      runtime: 'nodejs20.x',
      functionName: 'appian-connector-master-cleanupKafka',
      memorySize: 1024,
      timeout: 300,
      role: iamRoleLambdaExecution.attrArn,
      vpcConfig: {
        securityGroupIds: [
          lambdaSecurityGroup.ref,
        ],
        subnetIds: [
          'subnet-03bbabd1d3fb9c46e',
          'subnet-0bbc0152eb9ed753a',
          'subnet-085cb700629763306',
        ],
      },
    });
    cleanupKafkaLambdaFunction.addDependency(cleanupKafkaLogGroup);

    const connectorLogsErrorCount = new logs.CfnMetricFilter(this, 'ConnectorLogsErrorCount', {
      logGroupName: kafkaConnectWorkerLogGroup.ref,
      filterName: 'ConnectorLogsErrorCount',
      filterPattern: 'ERROR',
      metricTransformations: [
        {
          metricValue: '1',
          defaultValue: 0,
          metricNamespace: 'appian-connector-master/Connector/ERRORS',
          metricName: 'ConnectorLogsErrorCount',
          unit: 'Count',
        },
      ],
    });

    const connectorLogsWarnCount = new logs.CfnMetricFilter(this, 'ConnectorLogsWarnCount', {
      logGroupName: kafkaConnectWorkerLogGroup.ref,
      filterName: 'ConnectorLogsWarnCount',
      filterPattern: 'WARN',
      metricTransformations: [
        {
          metricValue: '1',
          defaultValue: 0,
          metricNamespace: 'appian-connector-master/Connector/WARNS',
          metricName: 'ConnectorLogsWarnCount',
          unit: 'Count',
        },
      ],
    });

    const createTopicsLambdaFunction = new lambda.CfnFunction(this, 'CreateTopicsLambdaFunction', {
      code: {
        s3Bucket: serverlessDeploymentBucket.ref,
        s3Key: 'serverless/appian-connector/master/1758423126062-2025-09-21T02:52:06.062Z/createTopics.zip',
      },
      handler: 'handlers/createTopics.handler',
      runtime: 'nodejs20.x',
      functionName: 'appian-connector-master-createTopics',
      memorySize: 1024,
      timeout: 300,
      role: iamRoleLambdaExecution.attrArn,
      vpcConfig: {
        securityGroupIds: [
          lambdaSecurityGroup.ref,
        ],
        subnetIds: [
          'subnet-03bbabd1d3fb9c46e',
          'subnet-0bbc0152eb9ed753a',
          'subnet-085cb700629763306',
        ],
      },
    });
    createTopicsLambdaFunction.addDependency(createTopicsLogGroup);

    const ecsFailureEventRule = new events.CfnRule(this, 'ECSFailureEventRule', {
      description: 'Connector Task Failure Event Rule',
      eventPattern: {
        account: [
          `${this.account}`,
        ],
        source: [
          'aws.ecs',
          'demo.cli',
        ],
        'detail-type': [
          'ECS Task State Change',
        ],
        detail: {
          lastStatus: [
            'STOPPED',
          ],
          stoppedReason: [
            'Essential container in task exited',
            'Task failed container health checks',
          ],
          clusterArn: [
            kafkaConnectCluster.attrArn,
          ],
        },
      },
      targets: [
        {
          arn: 'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
          id: 'ConnectorEcsTaskFailure',
          inputTransformer: {
            inputPathsMap: {
              clusterArn: '$.detail.clusterArn',
              status: '$.detail.lastStatus',
              account: '$.account',
              stoppedReason: '$.detail.stoppedReason',
            },
            inputTemplate: '\"An Connector ECS Task Failure Event has occured for appian-connectors. Account: <account> Cluster ARN: <clusterArn> Status: <status> Reason: <stoppedReason>\"\n',
          },
        },
      ],
    });

    const kafkaConnectWorkerSecurityGroupEgressLambda = new ec2.CfnSecurityGroupEgress(this, 'KafkaConnectWorkerSecurityGroupEgressLambda', {
      groupId: kafkaConnectWorkerSecurityGroup.ref,
      ipProtocol: '-1',
      cidrIp: '0.0.0.0/0',
    });

    const kafkaConnectWorkerSecurityGroupIngressCluster = new ec2.CfnSecurityGroupIngress(this, 'KafkaConnectWorkerSecurityGroupIngressCluster', {
      groupId: `${kafkaConnectWorkerSecurityGroup.ref}`,
      ipProtocol: 'tcp',
      fromPort: 8083,
      toPort: 8083,
      sourceSecurityGroupId: `${kafkaConnectWorkerSecurityGroup.ref}`,
    });

    const kafkaConnectWorkerSecurityGroupIngressLambda = new ec2.CfnSecurityGroupIngress(this, 'KafkaConnectWorkerSecurityGroupIngressLambda', {
      groupId: `${kafkaConnectWorkerSecurityGroup.ref}`,
      ipProtocol: 'tcp',
      fromPort: 8083,
      toPort: 8083,
      sourceSecurityGroupId: `${lambdaConfigureConnectorsSecurityGroup.ref}`,
    });

    const kafkaConnectWorkerTaskDefinition = new ecs.CfnTaskDefinition(this, 'KafkaConnectWorkerTaskDefinition', {
      containerDefinitions: [
        {
          name: 'connect',
          image: '677829493285.dkr.ecr.us-east-1.amazonaws.com/confluentinc/cp-kafka-connect:6.0.9',
          memory: 1024,
          cpu: 512,
          user: 'root',
          command: [
            'bash',
            '-c',
            'export ENI_IP=`curl $ECS_CONTAINER_METADATA_URI_V4 | sed -e \'s/.*IPv4Addresses\":\\[\"\\(.*\\)\"\\],\"AttachmentIndex.*/\\1/\'` &&\necho \"$ENI_IP localhost\" > /etc/hosts &&\necho \"export ENI_IP=$ENI_IP\" >> /home/appuser/.bashrc\nrunuser -p appuser -c \'\'\'\n  export HOME=/home/appuser &&\n  source /home/appuser/.bashrc\n  export CONNECT_REST_HOST_NAME=$ENI_IP &&\n  export CONNECT_REST_ADVERTISED_HOST_NAME=$ENI_IP &&\n  curl -L -O http://client.hub.confluent.io/confluent-hub-client-latest.tar.gz &&\n  tar -xzvf confluent-hub-client-latest.tar.gz &&\n  confluent-hub install confluentinc/kafka-connect-jdbc:10.5.1 --no-prompt &&\n  curl -L -o /usr/share/confluent-hub-components/confluentinc-kafka-connect-jdbc/lib/ojdbc10.jar  https://download.oracle.com/otn-pub/otn_software/jdbc/1916/ojdbc10.jar &&\n  /etc/confluent/docker/run\n\'\'\'\n',
          ],
          environment: [
            {
              name: 'CONNECT_BOOTSTRAP_SERVERS',
              value: 'b-1.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094,b-2.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094,b-3.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094',
            },
            {
              name: 'CONNECT_GROUP_ID',
              value: 'mgmt.connect.appian-connector-master',
            },
            {
              name: 'CONNECT_CONFIG_STORAGE_TOPIC',
              value: 'mgmt.connect.appian-connector-master.config',
            },
            {
              name: 'CONNECT_OFFSET_STORAGE_TOPIC',
              value: 'mgmt.connect.appian-connector-master.offsets',
            },
            {
              name: 'CONNECT_STATUS_STORAGE_TOPIC',
              value: 'mgmt.connect.appian-connector-master.status',
            },
            {
              name: 'CONNECT_OFFSET_STORAGE_PARTITIONS',
              value: '5',
            },
            {
              name: 'CONNECT_STATUS_STORAGE_PARTITIONS',
              value: '1',
            },
            {
              name: 'CONNECT_KEY_CONVERTER',
              value: 'org.apache.kafka.connect.json.JsonConverter',
            },
            {
              name: 'CONNECT_VALUE_CONVERTER',
              value: 'org.apache.kafka.connect.json.JsonConverter',
            },
            {
              name: 'CONNECT_INTERNAL_KEY_CONVERTER',
              value: 'org.apache.kafka.connect.json.JsonConverter',
            },
            {
              name: 'CONNECT_INTERNAL_VALUE_CONVERTER',
              value: 'org.apache.kafka.connect.json.JsonConverter',
            },
            {
              name: 'CONNECT_SECURITY_PROTOCOL',
              value: 'SSL',
            },
            {
              name: 'CONNECT_PRODUCER_BOOTSTRAP_SERVERS',
              value: 'b-1.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094,b-2.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094,b-3.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094',
            },
            {
              name: 'CONNECT_PRODUCER_SECURITY_PROTOCOL',
              value: 'SSL',
            },
            {
              name: 'CONNECT_CONSUMER_BOOTSTRAP_SERVERS',
              value: 'b-1.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094,b-2.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094,b-3.master-msk.zf7e0q.c7.kafka.us-east-1.amazonaws.com:9094',
            },
            {
              name: 'CONNECT_CONSUMER_SECURITY_PROTOCOL',
              value: 'SSL',
            },
            {
              name: 'CONNECT_PRODUCER_OFFSET_FLUSH_TIMEOUT_MS',
              value: '30000',
            },
          ],
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-region': `${this.region}`,
              'awslogs-group': `${kafkaConnectWorkerLogGroup.ref}`,
              'awslogs-stream-prefix': 'fargate',
              'awslogs-datetime-format': '\\[%Y-%m-%d %H:%M:%S,',
            },
          },
        },
        {
          name: 'instantclient',
          image: 'ghcr.io/oracle/oraclelinux8-instantclient:21',
          memory: 512,
          command: [
            'bash',
            '-c',
            'sleep infinity\n',
          ],
        },
      ],
      family: 'appian-connector-master-kafka-connect-worker',
      networkMode: 'awsvpc',
      executionRoleArn: kafkaConnectWorkerRole.attrArn,
      taskRoleArn: kafkaConnectWorkerRole.attrArn,
      requiresCompatibilities: [
        'FARGATE',
      ],
      memory: '2048',
      cpu: '1024',
      tags: [
      ],
    });

    const lambdaConfigureConnectorsSecurityGroupEgress = new ec2.CfnSecurityGroupEgress(this, 'LambdaConfigureConnectorsSecurityGroupEgress', {
      groupId: lambdaConfigureConnectorsSecurityGroup.ref,
      ipProtocol: '-1',
      cidrIp: '0.0.0.0/0',
    });

    const lambdaSecurityGroupEgress = new ec2.CfnSecurityGroupEgress(this, 'LambdaSecurityGroupEgress', {
      groupId: lambdaSecurityGroup.ref,
      ipProtocol: '-1',
      cidrIp: '0.0.0.0/0',
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

    const cleanupKafkaLambdaVersion4MiXEnAJiPcuJQoQc9RduTrkQe5LnZxXb7pLoySwx0c = new lambda.CfnVersion(this, 'CleanupKafkaLambdaVersion4MiXEnAJiPcuJQoQC9RduTrkQE5LnZxXB7pLoySwx0c', {
      functionName: cleanupKafkaLambdaFunction.ref,
      codeSha256: 'bTPxAj6bDAYSBizsLFDTvI1omOD5jkl9WN09hQmrv7M=',
    });
    cleanupKafkaLambdaVersion4MiXEnAJiPcuJQoQc9RduTrkQe5LnZxXb7pLoySwx0c.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

    const createTopicsLambdaVersion2fncYy5TnimukDcpPDnq5rEfs5jSQnSgmqo2clNoHsq = new lambda.CfnVersion(this, 'CreateTopicsLambdaVersion2fncYy5TNIMUKDcpPDnq5rEfs5jSQnSGMQO2CLNoHSQ', {
      functionName: createTopicsLambdaFunction.ref,
      codeSha256: 'ZzjD5KF6/rpLEIvUMxljrzcf29DmmYD/caOvZAnmOS8=',
    });
    createTopicsLambdaVersion2fncYy5TnimukDcpPDnq5rEfs5jSQnSgmqo2clNoHsq.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

    const kafkaConnectService = new ecs.CfnService(this, 'KafkaConnectService', {
      cluster: `${kafkaConnectCluster.ref}`,
      deploymentConfiguration: {
        deploymentCircuitBreaker: {
          enable: true,
          rollback: false,
        },
        maximumPercent: 100,
        minimumHealthyPercent: 0,
      },
      enableExecuteCommand: true,
      launchType: 'FARGATE',
      serviceName: 'kafka-connect',
      desiredCount: 1,
      taskDefinition: `${kafkaConnectWorkerTaskDefinition.ref}`,
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: 'DISABLED',
          securityGroups: [
            `${kafkaConnectWorkerSecurityGroup.ref}`,
          ],
          subnets: [
            'subnet-078c2a277bd53f882',
            'subnet-0a233e589a6c82311',
            'subnet-069c26eb4fda15bf4',
          ],
        },
      },
    });

    const configureConnectorsLambdaFunction = new lambda.CfnFunction(this, 'ConfigureConnectorsLambdaFunction', {
      code: {
        s3Bucket: serverlessDeploymentBucket.ref,
        s3Key: 'serverless/appian-connector/master/1758423126062-2025-09-21T02:52:06.062Z/configureConnectors.zip',
      },
      handler: 'handlers/configureConnectors.handler',
      runtime: 'nodejs20.x',
      functionName: 'appian-connector-master-configureConnectors',
      memorySize: 1024,
      timeout: 300,
      environment: {
        variables: {
          cluster: kafkaConnectCluster.ref,
          service: kafkaConnectService.ref,
          topicNamespace: '',
          legacydbIp: 'macpro-oracle-rds-test1.ch400yukw9kr.us-east-1.rds.amazonaws.com',
          legacydbPort: '1521',
          legacyDb: 'MACPRO',
          legacydbUser: 'BIGMACREAD',
          legacydbPassword: '!1BigMacRead',
          legacyschema: 'MACPROTEST1',
        },
      },
      role: iamRoleLambdaExecution.attrArn,
      vpcConfig: {
        securityGroupIds: [
          lambdaConfigureConnectorsSecurityGroup.ref,
        ],
        subnetIds: [
          'subnet-03bbabd1d3fb9c46e',
          'subnet-0bbc0152eb9ed753a',
          'subnet-085cb700629763306',
        ],
      },
    });
    configureConnectorsLambdaFunction.addDependency(configureConnectorsLogGroup);

    const kafkaConnectServiceEcsCpuAlarm = new cloudwatch.CfnAlarm(this, 'KafkaConnectServiceECSCpuAlarm', {
      alarmName: 'appian-connector-master-KafkaConnectService-CPUUtilization',
      alarmDescription: 'Trigger an alarm when the CPU utilization reaches 75%',
      namespace: 'AWS/ECS',
      metricName: 'CPUUtilization',
      dimensions: [
        {
          name: 'ClusterName',
          value: kafkaConnectCluster.ref,
        },
        {
          name: 'ServiceName',
          value: kafkaConnectService.attrName,
        },
      ],
      statistic: 'Average',
      period: 60,
      evaluationPeriods: 2,
      threshold: 75,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      alarmActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
      okActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
    });

    const kafkaConnectServiceEcsMemoryAlarm = new cloudwatch.CfnAlarm(this, 'KafkaConnectServiceECSMemoryAlarm', {
      alarmName: 'appian-connector-master-KafkaConnectService-MemoryUtilization',
      alarmDescription: 'Trigger an alarm when the Memory utilization reaches 75%',
      namespace: 'AWS/ECS',
      metricName: 'MemoryUtilization',
      dimensions: [
        {
          name: 'ClusterName',
          value: kafkaConnectCluster.ref,
        },
        {
          name: 'ServiceName',
          value: kafkaConnectService.attrName,
        },
      ],
      statistic: 'Average',
      period: 60,
      evaluationPeriods: 2,
      threshold: 75,
      comparisonOperator: 'GreaterThanOrEqualToThreshold',
      alarmActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
      okActions: [
        'arn:aws:sns:us-east-1:677829493285:Alerts-appian-alerts-master',
      ],
    });

    const testConnectorsLambdaFunction = new lambda.CfnFunction(this, 'TestConnectorsLambdaFunction', {
      code: {
        s3Bucket: serverlessDeploymentBucket.ref,
        s3Key: 'serverless/appian-connector/master/1758423126062-2025-09-21T02:52:06.062Z/testConnectors.zip',
      },
      handler: 'handlers/testConnectors.handler',
      runtime: 'nodejs20.x',
      functionName: 'appian-connector-master-testConnectors',
      memorySize: 1024,
      timeout: 300,
      environment: {
        variables: {
          cluster: kafkaConnectCluster.ref,
          service: kafkaConnectService.ref,
          namespace: 'appian-connector-master',
        },
      },
      role: iamRoleLambdaExecution.attrArn,
      vpcConfig: {
        securityGroupIds: [
          lambdaConfigureConnectorsSecurityGroup.ref,
        ],
        subnetIds: [
          'subnet-03bbabd1d3fb9c46e',
          'subnet-0bbc0152eb9ed753a',
          'subnet-085cb700629763306',
        ],
      },
    });
    testConnectorsLambdaFunction.addDependency(testConnectorsLogGroup);

    const configureConnectorsLambdaEvConf = new lambda.CfnEventInvokeConfig(this, 'ConfigureConnectorsLambdaEvConf', {
      functionName: configureConnectorsLambdaFunction.ref,
      destinationConfig: {
      },
      qualifier: '$LATEST',
      maximumRetryAttempts: 0,
    });

    const configureConnectorsLambdaVersionKa7f2stvpGzNIs6ExLhwcgSkCyXIkkCh4ef8Uk6bfoU = new lambda.CfnVersion(this, 'ConfigureConnectorsLambdaVersionKA7f2stvpGzNIs6ExLhwcgSKCyXIkkCH4EF8Uk6bfoU', {
      functionName: configureConnectorsLambdaFunction.ref,
      codeSha256: 'PONp6gbonz+swGVwuj4FAnwGwMdzZHkJDLzHg132Io0=',
    });
    configureConnectorsLambdaVersionKa7f2stvpGzNIs6ExLhwcgSkCyXIkkCh4ef8Uk6bfoU.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

    const testConnectorsEventsRuleSchedule1 = new events.CfnRule(this, 'TestConnectorsEventsRuleSchedule1', {
      scheduleExpression: 'cron(0/1 * ? * * *)',
      state: 'ENABLED',
      targets: [
        {
          arn: testConnectorsLambdaFunction.attrArn,
          id: 'testConnectorsSchedule',
        },
      ],
    });

    const testConnectorsLambdaVersion7YEztdHlW41b3AsXjhiqj0ItQhNpaccPpfYltMnfus = new lambda.CfnVersion(this, 'TestConnectorsLambdaVersion7YEztdHlW41B3AsXJHIQJ0ItQhNpaccPPFYltMnfus', {
      functionName: testConnectorsLambdaFunction.ref,
      codeSha256: 'LQBFjRr6H2gQqJ8dmurBr+PhLWcGRz/wvOHaKB4UUMc=',
    });
    testConnectorsLambdaVersion7YEztdHlW41b3AsXjhiqj0ItQhNpaccPpfYltMnfus.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;

    const testConnectorsLambdaPermissionEventsRuleSchedule1 = new lambda.CfnPermission(this, 'TestConnectorsLambdaPermissionEventsRuleSchedule1', {
      functionName: testConnectorsLambdaFunction.attrArn,
      action: 'lambda:InvokeFunction',
      principal: 'events.amazonaws.com',
      sourceArn: testConnectorsEventsRuleSchedule1.attrArn,
    });

    // Outputs
    this.serverlessDeploymentBucketName = serverlessDeploymentBucket.ref;
    new cdk.CfnOutput(this, 'CfnOutputServerlessDeploymentBucketName', {
      key: 'ServerlessDeploymentBucketName',
      exportName: 'sls-appian-connector-master-ServerlessDeploymentBucketName',
      value: this.serverlessDeploymentBucketName!.toString(),
    });
    this.createTopicsLambdaFunctionQualifiedArn = createTopicsLambdaVersion2fncYy5TnimukDcpPDnq5rEfs5jSQnSgmqo2clNoHsq.ref;
    new cdk.CfnOutput(this, 'CfnOutputCreateTopicsLambdaFunctionQualifiedArn', {
      key: 'CreateTopicsLambdaFunctionQualifiedArn',
      description: 'Current Lambda function version',
      exportName: 'sls-appian-connector-master-CreateTopicsLambdaFunctionQualifiedArn',
      value: this.createTopicsLambdaFunctionQualifiedArn!.toString(),
    });
    this.configureConnectorsLambdaFunctionQualifiedArn = configureConnectorsLambdaVersionKa7f2stvpGzNIs6ExLhwcgSkCyXIkkCh4ef8Uk6bfoU.ref;
    new cdk.CfnOutput(this, 'CfnOutputConfigureConnectorsLambdaFunctionQualifiedArn', {
      key: 'ConfigureConnectorsLambdaFunctionQualifiedArn',
      description: 'Current Lambda function version',
      exportName: 'sls-appian-connector-master-ConfigureConnectorsLambdaFunctionQualifiedArn',
      value: this.configureConnectorsLambdaFunctionQualifiedArn!.toString(),
    });
    this.cleanupKafkaLambdaFunctionQualifiedArn = cleanupKafkaLambdaVersion4MiXEnAJiPcuJQoQc9RduTrkQe5LnZxXb7pLoySwx0c.ref;
    new cdk.CfnOutput(this, 'CfnOutputCleanupKafkaLambdaFunctionQualifiedArn', {
      key: 'CleanupKafkaLambdaFunctionQualifiedArn',
      description: 'Current Lambda function version',
      exportName: 'sls-appian-connector-master-CleanupKafkaLambdaFunctionQualifiedArn',
      value: this.cleanupKafkaLambdaFunctionQualifiedArn!.toString(),
    });
    this.testConnectorsLambdaFunctionQualifiedArn = testConnectorsLambdaVersion7YEztdHlW41b3AsXjhiqj0ItQhNpaccPpfYltMnfus.ref;
    new cdk.CfnOutput(this, 'CfnOutputTestConnectorsLambdaFunctionQualifiedArn', {
      key: 'TestConnectorsLambdaFunctionQualifiedArn',
      description: 'Current Lambda function version',
      exportName: 'sls-appian-connector-master-TestConnectorsLambdaFunctionQualifiedArn',
      value: this.testConnectorsLambdaFunctionQualifiedArn!.toString(),
    });
    this.kafkaConnectWorkerSecurityGroupId = kafkaConnectWorkerSecurityGroup.ref;
    new cdk.CfnOutput(this, 'CfnOutputKafkaConnectWorkerSecurityGroupId', {
      key: 'KafkaConnectWorkerSecurityGroupId',
      description: 'The ID of the security group attached to the Kafka Connect cluster tasks.\nThis can be used by other resources to attach additional ingress rules.\n',
      value: this.kafkaConnectWorkerSecurityGroupId!.toString(),
    });
  }
}
