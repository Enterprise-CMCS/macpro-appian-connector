import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as path from "path";

import { FullEnvironmentConfig } from "./environment-config";

export interface AppianPwRotationStackProps extends cdk.StackProps {
  fullConfig: FullEnvironmentConfig;
  configureConnectorsFunctionName: string;
  kafkaConnectClusterName: string;
  kafkaConnectServiceName: string;
  connectorName: string;
  configureConnectorsLambdaSecurityGroupId: string;
  notificationSender: string;
  initialRecipients?: string;
}

const DEFAULT_INITIAL_RECIPIENTS = "benjamin.paige@cms.hhs.gov";

/**
 * Automated DB password rotation stack.
 *
 * When the appian/{stage}/dbInfo secret value changes (PutSecretValue,
 * UpdateSecret, or RotationSucceeded), an EventBridge rule invokes the
 * rotateDbPassword Lambda. The Lambda:
 *   1. Reads the new secret value
 *   2. Updates the configureConnectors Lambda env vars
 *   3. Invokes configureConnectors to push the new password to Kafka Connect
 *   4. Verifies the Kafka Connect source connector reaches RUNNING
 *   5. Sends a success or failure-with-remediation email via SES
 *
 * Email recipients are stored in SSM Parameter Store and read at runtime,
 * so the recipient list can be changed without redeploying.
 */
export class AppianPwRotationStack extends cdk.Stack {
  public readonly rotationLambdaName: string;
  public readonly recipientsParameterName: string;

  public constructor(scope: cdk.App, id: string, props: AppianPwRotationStackProps) {
    super(scope, id, props);

    const {
      fullConfig,
      configureConnectorsFunctionName,
      kafkaConnectClusterName,
      kafkaConnectServiceName,
      connectorName,
      configureConnectorsLambdaSecurityGroupId,
      notificationSender,
    } = props;
    const { stage, vpc, iamPath, iamPermissionsBoundary } = fullConfig;

    const servicePrefix = `appian-pw-rotation-${stage}`;
    const recipientsParameterName = `/appian/${stage}/pw-rotation/recipients`;

    const recipientsParameter = new ssm.CfnParameter(this, "RecipientsParameter", {
      name: recipientsParameterName,
      type: "String",
      value: props.initialRecipients ?? DEFAULT_INITIAL_RECIPIENTS,
      description:
        "Comma-separated list of email addresses notified when the Appian DB password is rotated. Edit this value in the console to change recipients at runtime; no redeploy required.",
      tier: "Standard",
    });

    const logGroup = new logs.CfnLogGroup(this, "RotationLogGroup", {
      logGroupName: `/aws/lambda/${servicePrefix}-rotateDbPassword`,
      retentionInDays: 30,
    });

    const dbSecretArnPattern = `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:appian/${stage}/dbInfo*`;
    const configureConnectorsArn = `arn:${this.partition}:lambda:${this.region}:${this.account}:function:${configureConnectorsFunctionName}`;
    const recipientsParameterArn = `arn:${this.partition}:ssm:${this.region}:${this.account}:parameter${recipientsParameterName}`;

    const rotationRole = new iam.CfnRole(this, "RotationRole", {
      roleName: `appian-pw-rotation-${stage}-${this.region}-lambdaRole`,
      path: iamPath,
      permissionsBoundary: iamPermissionsBoundary,
      assumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      },
      managedPolicyArns: [`arn:${this.partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole`],
      policies: [
        {
          policyName: `${servicePrefix}-lambda`,
          policyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Action: ["logs:CreateLogStream", "logs:PutLogEvents", "logs:TagResource"],
                Resource: `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/lambda/${servicePrefix}*:*`,
              },
              {
                Effect: "Allow",
                Action: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
                Resource: dbSecretArnPattern,
              },
              {
                Effect: "Allow",
                Action: ["lambda:GetFunctionConfiguration", "lambda:UpdateFunctionConfiguration", "lambda:InvokeFunction"],
                Resource: configureConnectorsArn,
              },
              {
                Effect: "Allow",
                Action: ["ssm:GetParameter"],
                Resource: recipientsParameterArn,
              },
              {
                Effect: "Allow",
                Action: ["ses:SendEmail", "ses:SendRawEmail"],
                Resource: "*",
                Condition: {
                  StringEquals: {
                    "ses:FromAddress": notificationSender,
                  },
                },
              },
              {
                Effect: "Allow",
                Action: ["ecs:ListTasks", "ecs:DescribeTasks"],
                Resource: "*",
              },
            ],
          },
        },
      ],
    });
    const rotationRoleName = `appian-pw-rotation-${stage}-${this.region}-lambdaRole`;

    const rotationFn = new NodejsFunction(this, "RotationFunction", {
      entry: path.join(__dirname, "../../src/services/pw-rotation/handlers/rotateDbPassword.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      functionName: `${servicePrefix}-rotateDbPassword`,
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logGroup: logs.LogGroup.fromLogGroupName(this, "RotationLogGroupRef", logGroup.logGroupName!),
      role: iam.Role.fromRoleName(this, "RotationRoleRef", rotationRoleName),
      environment: {
        STAGE: stage,
        DB_SECRET_ID: `appian/${stage}/dbInfo`,
        CONFIGURE_CONNECTORS_FUNCTION: configureConnectorsFunctionName,
        CLUSTER: kafkaConnectClusterName,
        SERVICE: kafkaConnectServiceName,
        CONNECTOR_NAME: connectorName,
        RECIPIENTS_SSM_PARAMETER: recipientsParameterName,
        NOTIFICATION_SENDER: notificationSender,
      },
      vpc: ec2.Vpc.fromVpcAttributes(this, "RotationVpc", {
        vpcId: vpc.id,
        availabilityZones: ["us-east-1a", "us-east-1b", "us-east-1c"],
        privateSubnetIds: vpc.privateSubnets,
      }),
      securityGroups: [ec2.SecurityGroup.fromSecurityGroupId(this, "RotationSg", configureConnectorsLambdaSecurityGroupId)],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });
    const cfnRotationFn = rotationFn.node.defaultChild as lambda.CfnFunction;
    cfnRotationFn.overrideLogicalId("RotateDbPasswordLambdaFunction");
    cfnRotationFn.addDependency(logGroup);

    new events.Rule(this, "RotationEventRule", {
      ruleName: `${servicePrefix}-secretChange`,
      description: `Detects updates to ${dbSecretArnPattern} and triggers DB password rotation.`,
      eventPattern: {
        source: ["aws.secretsmanager"],
        detailType: ["AWS API Call via CloudTrail"],
        detail: {
          eventSource: ["secretsmanager.amazonaws.com"],
          eventName: ["PutSecretValue", "UpdateSecret", "RotationSucceeded"],
          requestParameters: {
            secretId: [{ wildcard: `*appian/${stage}/dbInfo*` }],
          },
        },
      },
      targets: [new targets.LambdaFunction(rotationFn)],
    });

    this.rotationLambdaName = rotationFn.functionName;
    this.recipientsParameterName = recipientsParameter.name!;

    new cdk.CfnOutput(this, "RotationLambdaName", {
      value: this.rotationLambdaName,
      description: "Name of the rotation Lambda function.",
    });
    new cdk.CfnOutput(this, "RecipientsParameterName", {
      value: this.recipientsParameterName,
      description: "SSM parameter holding the comma-separated email recipients. Edit in the console to change recipients without redeploying.",
    });
  }
}
