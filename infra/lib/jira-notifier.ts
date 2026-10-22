import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsDestination } from "aws-cdk-lib/aws-lambda-destinations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import * as path from "node:path";
import type { VpcConfig } from "./environment-config";

export interface JiraNotifierProps {
  stage: string;
  servicePrefix: string;
  stageLabel: "VAL" | "PROD";
  alertsTopicArn: string;
  handlersPath: string;
  vpc: VpcConfig;
  securityGroupId: string;
  logsKey: kms.IKey;
  iamPath: string;
  iamPermissionsBoundary: string;
}

export class JiraNotifier extends Construct {
  public readonly function: NodejsFunction;

  public constructor(scope: Construct, id: string, props: JiraNotifierProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const functionName = `${props.servicePrefix}-jiraNotifier`;
    const secretId = `appian/${props.stage}/jira`;

    const deadLetterQueue = new sqs.Queue(this, "DeadLetterQueue", {
      queueName: `${functionName}-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: cdk.Duration.days(14),
    });

    const role = new iam.Role(this, "Role", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      path: props.iamPath,
      permissionsBoundary: iam.ManagedPolicy.fromManagedPolicyArn(this, "PermissionsBoundary", props.iamPermissionsBoundary),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole")],
    });
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [`arn:${stack.partition}:secretsmanager:${stack.region}:${stack.account}:secret:${secretId}-*`],
      })
    );

    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${functionName}`,
      encryptionKey: props.logsKey,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    this.function = new NodejsFunction(this, "Function", {
      entry: path.join(props.handlersPath, "jiraNotifier.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      functionName,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 1,
      retryAttempts: 2,
      onFailure: new SqsDestination(deadLetterQueue),
      logGroup,
      role,
      environment: {
        stage: props.stage,
        servicePrefix: props.servicePrefix,
        jiraStageLabel: props.stageLabel,
        jiraSecretId: secretId,
      },
      vpc: ec2.Vpc.fromVpcAttributes(this, "Vpc", {
        vpcId: props.vpc.id,
        availabilityZones: ["us-east-1a", "us-east-1b", "us-east-1c"],
        privateSubnetIds: props.vpc.privateSubnets,
      }),
      securityGroups: [ec2.SecurityGroup.fromSecurityGroupId(this, "SecurityGroup", props.securityGroupId)],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    new events.Rule(this, "AlarmStateChangeRule", {
      description: `Opens or updates Jira tickets for ${props.servicePrefix} connection alarms`,
      eventPattern: {
        source: ["aws.cloudwatch"],
        detailType: ["CloudWatch Alarm State Change"],
        detail: {
          alarmName: events.Match.prefix(`${props.servicePrefix}-conn-`),
          state: { value: ["ALARM", "OK"] },
        },
      },
      targets: [new targets.LambdaFunction(this.function)],
    });

    new cloudwatch.CfnAlarm(this, "DeadLetterQueueAlarm", {
      alarmName: `${functionName}-dlq`,
      alarmDescription: "The Jira notifier could not open or update a ticket. Check the jiraNotifier logs.",
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensions: [{ name: "QueueName", value: deadLetterQueue.queueName }],
      statistic: "Maximum",
      period: 300,
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
      treatMissingData: "notBreaching",
      alarmActions: [props.alertsTopicArn],
    });
  }
}
