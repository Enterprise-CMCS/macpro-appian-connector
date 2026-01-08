import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as events from "aws-cdk-lib/aws-events";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { FullEnvironmentConfig } from "./environment-config";

export interface AppianConnectorStackProps extends cdk.StackProps {
  /**
   * Full environment configuration including secrets from AWS Secrets Manager.
   * Contains VPC, MSK, database, IAM, and ECS resource settings.
   */
  fullConfig: FullEnvironmentConfig;
}

/**
 * Appian Connector Stack - Parameterized for multi-environment deployment.
 *
 * All environment-specific values are resolved from AWS Secrets Manager:
 * - VPC ID and subnets from appian/{stage}/vpc
 * - MSK bootstrap servers from appian/{stage}/brokerString
 * - Database credentials from appian/{stage}/dbInfo
 * - IAM paths from appian/{stage}/iam/*
 * - ECR image from ecr/images/appian/appian-connector
 *
 * Note: createTopics and cleanupKafka Lambda functions have been removed
 * as they are only needed for ephemeral environments. Topics for master,
 * val, and production already exist.
 */
export class AppianConnectorStack extends cdk.Stack {
  public readonly serverlessDeploymentBucketName;
  public readonly kafkaConnectWorkerSecurityGroupId;

  public constructor(scope: cdk.App, id: string, props: AppianConnectorStackProps) {
    super(scope, id, props);

    // Extract full environment config
    const { fullConfig } = props;
    const { stage, vpc, brokerString, dbInfo, iamPath, iamPermissionsBoundary, ecrImage } = fullConfig;

    // Service prefix for resource naming
    const servicePrefix = `appian-connector-${stage}`;

    // SNS Topic ARN for alerts (references the alerts stack in the same account)
    const alertsTopicArn = `arn:aws:sns:${this.region}:${this.account}:Alerts-appian-alerts-${stage}`;

    // Path to Lambda handlers (relative to infra directory)
    const handlersPath = path.join(__dirname, "../../src/services/connector/handlers");

    // Resources
    const configureConnectorsLogGroup = new logs.CfnLogGroup(this, "ConfigureConnectorsLogGroup", {
      logGroupName: `/aws/lambda/${servicePrefix}-configureConnectors`,
    });

    const connectorLogsErrorCountAlarm = new cloudwatch.CfnAlarm(this, "ConnectorLogsErrorCountAlarm", {
      datapointsToAlarm: 1,
      alarmActions: [alertsTopicArn],
      alarmName: `${servicePrefix}-ConnectorLogsErrorCount`,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      evaluationPeriods: 2,
      period: 300,
      threshold: 1,
      metricName: "ConnectorLogsErrorCount",
      namespace: `${servicePrefix}/Connector/ERRORS`,
      statistic: "Sum",
    });

    const connectorLogsWarnCountAlarm = new cloudwatch.CfnAlarm(this, "ConnectorLogsWarnCountAlarm", {
      datapointsToAlarm: 1,
      alarmActions: [alertsTopicArn],
      alarmName: `${servicePrefix}-ConnectorLogsWarnCount`,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      evaluationPeriods: 2,
      period: 300,
      threshold: 3,
      metricName: "ConnectorLogsWarnCount",
      namespace: `${servicePrefix}/Connector/WARNS`,
      statistic: "Sum",
    });

    const iamRoleLambdaExecution = new iam.CfnRole(this, "IamRoleLambdaExecution", {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: ["lambda.amazonaws.com"],
            },
            Action: ["sts:AssumeRole"],
          },
        ],
      },
      policies: [
        {
          policyName: `${servicePrefix}-lambda`,
          policyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["logs:CreateLogStream", "logs:CreateLogGroup", "logs:TagResource"],
                Resource: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/${servicePrefix}*:*`],
              },
              {
                Effect: "Allow",
                Action: ["logs:PutLogEvents"],
                Resource: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/${servicePrefix}*:*:*`],
              },
              {
                Effect: "Allow",
                Action: [
                  "ec2:CreateNetworkInterface",
                  "ec2:DeleteNetworkInterface",
                  "ec2:DetachNetworkInterface",
                  "ec2:DescribeNetworkInterfaces",
                  "ec2:DescribeSecurityGroups",
                  "ec2:DescribeSubnets",
                  "ec2:DescribeVpcs",
                ],
                Resource: "*",
              },
              {
                Effect: "Allow",
                Action: ["ecs:ListTasks", "ecs:DescribeTasks"],
                Resource: "*",
              },
              {
                Effect: "Allow",
                Action: ["cloudwatch:PutMetricData"],
                Resource: "*",
              },
            ],
          },
        },
      ],
      path: iamPath,
      roleName: `appian-connector-${stage}-${this.region}-lambdaRole`,
      permissionsBoundary: iamPermissionsBoundary,
      managedPolicyArns: [`arn:${this.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole`],
    });

    const jdbcConnectorAlarm = new cloudwatch.CfnAlarm(this, "JdbcConnectorAlarm", {
      alarmActions: [alertsTopicArn],
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      datapointsToAlarm: 2,
      evaluationPeriods: 5,
      metricName: "source.jdbc.appian-dbo-1_failures",
      namespace: servicePrefix,
      period: 60,
      statistic: "Sum",
      threshold: 1,
    });

    const jdbcTaskAlarm = new cloudwatch.CfnAlarm(this, "JdbcTaskAlarm", {
      alarmActions: [alertsTopicArn],
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      datapointsToAlarm: 2,
      evaluationPeriods: 5,
      metricName: "source.jdbc.appian-dbo-1_task_failures",
      namespace: servicePrefix,
      period: 60,
      statistic: "Sum",
      threshold: 1,
    });

    const kafkaConnectCluster = new ecs.CfnCluster(this, "KafkaConnectCluster", {
      clusterName: `${servicePrefix}-connect`,
      clusterSettings: [
        {
          name: "containerInsights",
          value: "enabled",
        },
      ],
    });

    const kafkaConnectWorkerLogGroup = new logs.CfnLogGroup(this, "KafkaConnectWorkerLogGroup", {
      logGroupName: `/aws/fargate/${servicePrefix}-kafka-connect`,
    });

    const kafkaConnectWorkerRole = new iam.CfnRole(this, "KafkaConnectWorkerRole", {
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: ["ecs.amazonaws.com", "ecs-tasks.amazonaws.com"],
            },
            Action: "sts:AssumeRole",
          },
        ],
      },
      managedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"],
      policies: [
        {
          policyName: "LambdaRolePolicy",
          policyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "ssmmessages:CreateControlChannel",
                  "ssmmessages:CreateDataChannel",
                  "ssmmessages:OpenControlChannel",
                  "ssmmessages:OpenDataChannel",
                ],
                Resource: "*",
              },
              {
                Effect: "Allow",
                Action: ["ecr:BatchGetImage"],
                Resource: `arn:aws:ecr:us-east-1:${this.account}:repository/*`,
              },
            ],
          },
        },
      ],
      path: iamPath,
      permissionsBoundary: iamPermissionsBoundary,
    });

    const kafkaConnectWorkerSecurityGroup = new ec2.CfnSecurityGroup(this, "KafkaConnectWorkerSecurityGroup", {
      groupDescription: "Security Group for the Fargate Connect Workers.",
      vpcId: vpc.id,
    });

    const lambdaConfigureConnectorsSecurityGroup = new ec2.CfnSecurityGroup(this, "LambdaConfigureConnectorsSecurityGroup", {
      groupDescription: "Security Group for configuring the connector.",
      vpcId: vpc.id,
    });

    const serverlessDeploymentBucket = new s3.CfnBucket(this, "ServerlessDeploymentBucket", {
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          {
            serverSideEncryptionByDefault: {
              sseAlgorithm: "AES256",
            },
          },
        ],
      },
      versioningConfiguration: {
        status: "Enabled",
      },
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
    });

    const testConnectorsLogGroup = new logs.CfnLogGroup(this, "TestConnectorsLogGroup", {
      logGroupName: `/aws/lambda/${servicePrefix}-testConnectors`,
    });

    const connectorLogsErrorCount = new logs.CfnMetricFilter(this, "ConnectorLogsErrorCount", {
      logGroupName: kafkaConnectWorkerLogGroup.ref,
      filterName: "ConnectorLogsErrorCount",
      filterPattern: "ERROR",
      metricTransformations: [
        {
          metricValue: "1",
          defaultValue: 0,
          metricNamespace: `${servicePrefix}/Connector/ERRORS`,
          metricName: "ConnectorLogsErrorCount",
          unit: "Count",
        },
      ],
    });

    const connectorLogsWarnCount = new logs.CfnMetricFilter(this, "ConnectorLogsWarnCount", {
      logGroupName: kafkaConnectWorkerLogGroup.ref,
      filterName: "ConnectorLogsWarnCount",
      filterPattern: "WARN",
      metricTransformations: [
        {
          metricValue: "1",
          defaultValue: 0,
          metricNamespace: `${servicePrefix}/Connector/WARNS`,
          metricName: "ConnectorLogsWarnCount",
          unit: "Count",
        },
      ],
    });

    const ecsFailureEventRule = new events.CfnRule(this, "ECSFailureEventRule", {
      description: "Connector Task Failure Event Rule",
      eventPattern: {
        account: [`${this.account}`],
        source: ["aws.ecs", "demo.cli"],
        "detail-type": ["ECS Task State Change"],
        detail: {
          lastStatus: ["STOPPED"],
          stoppedReason: ["Essential container in task exited", "Task failed container health checks"],
          clusterArn: [kafkaConnectCluster.attrArn],
        },
      },
      targets: [
        {
          arn: alertsTopicArn,
          id: "ConnectorEcsTaskFailure",
          inputTransformer: {
            inputPathsMap: {
              clusterArn: "$.detail.clusterArn",
              status: "$.detail.lastStatus",
              account: "$.account",
              stoppedReason: "$.detail.stoppedReason",
            },
            inputTemplate:
              '"An Connector ECS Task Failure Event has occured for appian-connectors. Account: <account> Cluster ARN: <clusterArn> Status: <status> Reason: <stoppedReason>"\n',
          },
        },
      ],
    });

    const kafkaConnectWorkerSecurityGroupEgressLambda = new ec2.CfnSecurityGroupEgress(this, "KafkaConnectWorkerSecurityGroupEgressLambda", {
      groupId: kafkaConnectWorkerSecurityGroup.ref,
      ipProtocol: "-1",
      cidrIp: "0.0.0.0/0",
    });

    const kafkaConnectWorkerSecurityGroupIngressCluster = new ec2.CfnSecurityGroupIngress(this, "KafkaConnectWorkerSecurityGroupIngressCluster", {
      groupId: `${kafkaConnectWorkerSecurityGroup.ref}`,
      ipProtocol: "tcp",
      fromPort: 8083,
      toPort: 8083,
      sourceSecurityGroupId: `${kafkaConnectWorkerSecurityGroup.ref}`,
    });

    const kafkaConnectWorkerSecurityGroupIngressLambda = new ec2.CfnSecurityGroupIngress(this, "KafkaConnectWorkerSecurityGroupIngressLambda", {
      groupId: `${kafkaConnectWorkerSecurityGroup.ref}`,
      ipProtocol: "tcp",
      fromPort: 8083,
      toPort: 8083,
      sourceSecurityGroupId: `${lambdaConfigureConnectorsSecurityGroup.ref}`,
    });

    // Kafka Connect topic naming follows the pattern: mgmt.connect.{service-prefix}.*
    const connectGroupId = `mgmt.connect.${servicePrefix}`;

    const kafkaConnectWorkerTaskDefinition = new ecs.CfnTaskDefinition(this, "KafkaConnectWorkerTaskDefinition", {
      containerDefinitions: [
        {
          name: "connect",
          image: ecrImage,
          memory: fullConfig.connectContainerMemory,
          cpu: fullConfig.connectContainerCpu,
          user: "root",
          command: [
            "bash",
            "-c",
            "export ENI_IP=`curl $ECS_CONTAINER_METADATA_URI_V4 | sed -e 's/.*IPv4Addresses\":\\[\"\\(.*\\)\"\\],\"AttachmentIndex.*/\\1/'` &&\necho \"$ENI_IP localhost\" > /etc/hosts &&\necho \"export ENI_IP=$ENI_IP\" >> /home/appuser/.bashrc\nrunuser -p appuser -c '''\n  export HOME=/home/appuser &&\n  source /home/appuser/.bashrc\n  export CONNECT_REST_HOST_NAME=$ENI_IP &&\n  export CONNECT_REST_ADVERTISED_HOST_NAME=$ENI_IP &&\n  curl -L -O http://client.hub.confluent.io/confluent-hub-client-latest.tar.gz &&\n  tar -xzvf confluent-hub-client-latest.tar.gz &&\n  confluent-hub install confluentinc/kafka-connect-jdbc:10.5.1 --no-prompt &&\n  curl -L -o /usr/share/confluent-hub-components/confluentinc-kafka-connect-jdbc/lib/ojdbc10.jar  https://download.oracle.com/otn-pub/otn_software/jdbc/1916/ojdbc10.jar &&\n  /etc/confluent/docker/run\n'''\n",
          ],
          environment: [
            { name: "CONNECT_BOOTSTRAP_SERVERS", value: brokerString },
            { name: "CONNECT_GROUP_ID", value: connectGroupId },
            { name: "CONNECT_CONFIG_STORAGE_TOPIC", value: `${connectGroupId}.config` },
            { name: "CONNECT_OFFSET_STORAGE_TOPIC", value: `${connectGroupId}.offsets` },
            { name: "CONNECT_STATUS_STORAGE_TOPIC", value: `${connectGroupId}.status` },
            { name: "CONNECT_OFFSET_STORAGE_PARTITIONS", value: "5" },
            { name: "CONNECT_STATUS_STORAGE_PARTITIONS", value: "1" },
            { name: "CONNECT_KEY_CONVERTER", value: "org.apache.kafka.connect.json.JsonConverter" },
            { name: "CONNECT_VALUE_CONVERTER", value: "org.apache.kafka.connect.json.JsonConverter" },
            { name: "CONNECT_INTERNAL_KEY_CONVERTER", value: "org.apache.kafka.connect.json.JsonConverter" },
            { name: "CONNECT_INTERNAL_VALUE_CONVERTER", value: "org.apache.kafka.connect.json.JsonConverter" },
            { name: "CONNECT_SECURITY_PROTOCOL", value: "SSL" },
            { name: "CONNECT_PRODUCER_BOOTSTRAP_SERVERS", value: brokerString },
            { name: "CONNECT_PRODUCER_SECURITY_PROTOCOL", value: "SSL" },
            { name: "CONNECT_CONSUMER_BOOTSTRAP_SERVERS", value: brokerString },
            { name: "CONNECT_CONSUMER_SECURITY_PROTOCOL", value: "SSL" },
            { name: "CONNECT_PRODUCER_OFFSET_FLUSH_TIMEOUT_MS", value: "30000" },
          ],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-region": `${this.region}`,
              "awslogs-group": `${kafkaConnectWorkerLogGroup.ref}`,
              "awslogs-stream-prefix": "fargate",
              "awslogs-datetime-format": "\\[%Y-%m-%d %H:%M:%S,",
            },
          },
        },
        {
          name: "instantclient",
          image: "ghcr.io/oracle/oraclelinux8-instantclient:21",
          memory: fullConfig.instantClientContainerMemory,
          command: ["bash", "-c", "sleep infinity\n"],
        },
      ],
      family: `${servicePrefix}-kafka-connect-worker`,
      networkMode: "awsvpc",
      executionRoleArn: kafkaConnectWorkerRole.attrArn,
      taskRoleArn: kafkaConnectWorkerRole.attrArn,
      requiresCompatibilities: ["FARGATE"],
      memory: fullConfig.taskMemory,
      cpu: fullConfig.taskCpu,
      tags: [],
    });

    const lambdaConfigureConnectorsSecurityGroupEgress = new ec2.CfnSecurityGroupEgress(this, "LambdaConfigureConnectorsSecurityGroupEgress", {
      groupId: lambdaConfigureConnectorsSecurityGroup.ref,
      ipProtocol: "-1",
      cidrIp: "0.0.0.0/0",
    });

    const serverlessDeploymentBucketPolicy = new s3.CfnBucketPolicy(this, "ServerlessDeploymentBucketPolicy", {
      bucket: serverlessDeploymentBucket.ref,
      policyDocument: {
        Statement: [
          {
            Action: "s3:*",
            Effect: "Deny",
            Principal: "*",
            Resource: [
              `arn:${this.partition}:s3:::${serverlessDeploymentBucket.ref}/*`,
              `arn:${this.partition}:s3:::${serverlessDeploymentBucket.ref}`,
            ],
            Condition: {
              Bool: {
                "aws:SecureTransport": false,
              },
            },
          },
        ],
      },
    });

    const kafkaConnectService = new ecs.CfnService(this, "KafkaConnectService", {
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
      launchType: "FARGATE",
      serviceName: "kafka-connect",
      desiredCount: 1,
      taskDefinition: `${kafkaConnectWorkerTaskDefinition.ref}`,
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: "DISABLED",
          securityGroups: [`${kafkaConnectWorkerSecurityGroup.ref}`],
          subnets: vpc.dataSubnets,
        },
      },
    });

    // Configure Connectors Lambda - Uses NodejsFunction for automatic bundling
    // Override logical ID to preserve CloudFormation compatibility
    // Note: We use logGroup from the existing CfnLogGroup to prevent NodejsFunction from creating its own
    const configureConnectorsLogGroupL2 = logs.LogGroup.fromLogGroupName(
      this,
      "ConfigureConnectorsLogGroupRef",
      `/aws/lambda/${servicePrefix}-configureConnectors`
    );
    const configureConnectorsLambdaFunction = new NodejsFunction(this, "ConfigureConnectorsNodejs", {
      entry: path.join(handlersPath, "configureConnectors.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      functionName: `${servicePrefix}-configureConnectors`,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(300),
      logGroup: configureConnectorsLogGroupL2,
      environment: {
        cluster: kafkaConnectCluster.ref,
        service: kafkaConnectService.ref,
        topicNamespace: "",
        legacydbIp: dbInfo.ip,
        legacydbPort: dbInfo.port,
        legacyDb: dbInfo.db,
        legacydbUser: dbInfo.user,
        legacydbPassword: dbInfo.password,
        legacyschema: dbInfo.schema,
      },
      role: iam.Role.fromRoleArn(this, "ConfigureConnectorsRole", iamRoleLambdaExecution.attrArn),
      vpc: ec2.Vpc.fromVpcAttributes(this, "ConfigureConnectorsVpc", {
        vpcId: vpc.id,
        availabilityZones: ["us-east-1a", "us-east-1b", "us-east-1c"],
        privateSubnetIds: vpc.privateSubnets,
      }),
      securityGroups: [ec2.SecurityGroup.fromSecurityGroupId(this, "ConfigureConnectorsSg", lambdaConfigureConnectorsSecurityGroup.ref)],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });
    // Override the logical ID to match the original CloudFormation resource
    const cfnConfigureConnectors = configureConnectorsLambdaFunction.node.defaultChild as lambda.CfnFunction;
    cfnConfigureConnectors.overrideLogicalId("ConfigureConnectorsLambdaFunction");
    cfnConfigureConnectors.addDependency(configureConnectorsLogGroup);

    const kafkaConnectServiceEcsCpuAlarm = new cloudwatch.CfnAlarm(this, "KafkaConnectServiceECSCpuAlarm", {
      alarmName: `${servicePrefix}-KafkaConnectService-CPUUtilization`,
      alarmDescription: "Trigger an alarm when the CPU utilization reaches 75%",
      namespace: "AWS/ECS",
      metricName: "CPUUtilization",
      dimensions: [
        { name: "ClusterName", value: kafkaConnectCluster.ref },
        { name: "ServiceName", value: kafkaConnectService.attrName },
      ],
      statistic: "Average",
      period: 60,
      evaluationPeriods: 2,
      threshold: 75,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      alarmActions: [alertsTopicArn],
      okActions: [alertsTopicArn],
    });

    const kafkaConnectServiceEcsMemoryAlarm = new cloudwatch.CfnAlarm(this, "KafkaConnectServiceECSMemoryAlarm", {
      alarmName: `${servicePrefix}-KafkaConnectService-MemoryUtilization`,
      alarmDescription: "Trigger an alarm when the Memory utilization reaches 75%",
      namespace: "AWS/ECS",
      metricName: "MemoryUtilization",
      dimensions: [
        { name: "ClusterName", value: kafkaConnectCluster.ref },
        { name: "ServiceName", value: kafkaConnectService.attrName },
      ],
      statistic: "Average",
      period: 60,
      evaluationPeriods: 2,
      threshold: 75,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      alarmActions: [alertsTopicArn],
      okActions: [alertsTopicArn],
    });

    // Test Connectors Lambda - Uses NodejsFunction for automatic bundling
    // Override logical ID to preserve CloudFormation compatibility
    // Note: We use logGroup from the existing CfnLogGroup to prevent NodejsFunction from creating its own
    const testConnectorsLogGroupL2 = logs.LogGroup.fromLogGroupName(this, "TestConnectorsLogGroupRef", `/aws/lambda/${servicePrefix}-testConnectors`);
    const testConnectorsLambdaFunction = new NodejsFunction(this, "TestConnectorsNodejs", {
      entry: path.join(handlersPath, "testConnectors.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      functionName: `${servicePrefix}-testConnectors`,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(300),
      logGroup: testConnectorsLogGroupL2,
      environment: {
        cluster: kafkaConnectCluster.ref,
        service: kafkaConnectService.ref,
        namespace: servicePrefix,
      },
      role: iam.Role.fromRoleArn(this, "TestConnectorsRole", iamRoleLambdaExecution.attrArn),
      vpc: ec2.Vpc.fromVpcAttributes(this, "TestConnectorsVpc", {
        vpcId: vpc.id,
        availabilityZones: ["us-east-1a", "us-east-1b", "us-east-1c"],
        privateSubnetIds: vpc.privateSubnets,
      }),
      securityGroups: [ec2.SecurityGroup.fromSecurityGroupId(this, "TestConnectorsSg", lambdaConfigureConnectorsSecurityGroup.ref)],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });
    // Override the logical ID to match the original CloudFormation resource
    const cfnTestConnectors = testConnectorsLambdaFunction.node.defaultChild as lambda.CfnFunction;
    cfnTestConnectors.overrideLogicalId("TestConnectorsLambdaFunction");
    cfnTestConnectors.addDependency(testConnectorsLogGroup);

    const configureConnectorsLambdaEvConf = new lambda.CfnEventInvokeConfig(this, "ConfigureConnectorsLambdaEvConf", {
      functionName: configureConnectorsLambdaFunction.functionName,
      destinationConfig: {},
      qualifier: "$LATEST",
      maximumRetryAttempts: 0,
    });

    const testConnectorsEventsRuleSchedule1 = new events.CfnRule(this, "TestConnectorsEventsRuleSchedule1", {
      scheduleExpression: "cron(0/1 * ? * * *)",
      state: "ENABLED",
      targets: [
        {
          arn: testConnectorsLambdaFunction.functionArn,
          id: "testConnectorsSchedule",
        },
      ],
    });

    const testConnectorsLambdaPermissionEventsRuleSchedule1 = new lambda.CfnPermission(this, "TestConnectorsLambdaPermissionEventsRuleSchedule1", {
      functionName: testConnectorsLambdaFunction.functionArn,
      action: "lambda:InvokeFunction",
      principal: "events.amazonaws.com",
      sourceArn: testConnectorsEventsRuleSchedule1.attrArn,
    });

    // Outputs
    this.serverlessDeploymentBucketName = serverlessDeploymentBucket.ref;
    new cdk.CfnOutput(this, "CfnOutputServerlessDeploymentBucketName", {
      key: "ServerlessDeploymentBucketName",
      exportName: `sls-appian-connector-${stage}-ServerlessDeploymentBucketName`,
      value: this.serverlessDeploymentBucketName!.toString(),
    });
    this.kafkaConnectWorkerSecurityGroupId = kafkaConnectWorkerSecurityGroup.ref;
    new cdk.CfnOutput(this, "CfnOutputKafkaConnectWorkerSecurityGroupId", {
      key: "KafkaConnectWorkerSecurityGroupId",
      description:
        "The ID of the security group attached to the Kafka Connect cluster tasks.\nThis can be used by other resources to attach additional ingress rules.\n",
      value: this.kafkaConnectWorkerSecurityGroupId!.toString(),
    });
  }
}
