import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';
import { ComputeStack } from './compute-stack';
import { MessagingStack } from './messaging-stack';
import { NotificationQueue } from '../constructs/notification-queue';

// ─────────────────────────────────────────────────────────────────────────────
// DataOpsStack
// Provisions DynamoDB tables, CloudWatch log groups, alarms, and the
// ops dashboard for the PostOp Care platform.
//
// Dependencies:
//   - ComputeStack  → Lambda function handles for IAM grant calls
//   - MessagingStack → alertsTopic for alarm actions, SQS DLQ metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface DataOpsStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
  computeStack: ComputeStack;
  messagingStack: MessagingStack;
}

export class DataOpsStack extends cdk.Stack {
  /** DynamoDB table for authentication audit events */
  public readonly auditAuthTable: dynamodb.Table;
  /** DynamoDB table for reminder delivery tracking */
  public readonly reminderDeliveryTable: dynamodb.Table;
  /** KMS CMK used to encrypt the DynamoDB tables */
  public readonly dynamoKmsKey: kms.Key;

  constructor(scope: Construct, id: string, props: DataOpsStackProps) {
    super(scope, id, props);

    const { config, computeStack, messagingStack } = props;
    const env = config.env;
    const isProd = env === 'prod';
    const tableRemovalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // ── 1. KMS CMK for DynamoDB ───────────────────────────────────────────────
    this.dynamoKmsKey = new kms.Key(this, 'DynamoKmsKey', {
      alias: `postopcare-dynamodb-${env}`,
      description: `PostOp Care DynamoDB encryption key (${env})`,
      enableKeyRotation: true,
      removalPolicy: tableRemovalPolicy,
    });

    // ── 2. DynamoDB: audit-auth-${env} ────────────────────────────────────────
    // Stores authentication events (login, logout, token refresh, failed attempts).
    // PK: userId  SK: eventId  TTL: expiresAt
    this.auditAuthTable = new dynamodb.Table(this, 'AuditAuthTable', {
      tableName: `audit-auth-${env}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.dynamoKmsKey,
      pointInTimeRecovery: true,
      removalPolicy: tableRemovalPolicy,
      timeToLiveAttribute: 'expiresAt',
    });

    // GSI: query all events of a specific type sorted by creation time
    this.auditAuthTable.addGlobalSecondaryIndex({
      indexName: 'byEventType',
      partitionKey: { name: 'eventType', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── 3. DynamoDB: reminder-delivery-${env} ─────────────────────────────────
    // Tracks each outbound notification delivery attempt.
    // PK: reminderScheduleId  SK: deliveryId  TTL: expiresAt
    this.reminderDeliveryTable = new dynamodb.Table(this, 'ReminderDeliveryTable', {
      tableName: `reminder-delivery-${env}`,
      partitionKey: {
        name: 'reminderScheduleId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: 'deliveryId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.dynamoKmsKey,
      pointInTimeRecovery: true,
      removalPolicy: tableRemovalPolicy,
      timeToLiveAttribute: 'expiresAt',
    });

    // GSI: query deliveries for a specific patient sorted by time
    this.reminderDeliveryTable.addGlobalSecondaryIndex({
      indexName: 'byPatient',
      partitionKey: { name: 'patientId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI: query deliveries by delivery status sorted by time (e.g. PENDING, SENT, FAILED)
    this.reminderDeliveryTable.addGlobalSecondaryIndex({
      indexName: 'byStatus',
      partitionKey: {
        name: 'deliveryStatus',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── 4. IAM grants: Lambda → DynamoDB ─────────────────────────────────────
    //
    // ComputeStack currently exports three Lambda handles:
    //   - apiHandlerFunction       → used here as a proxy for auth writes
    //   - milestoneEvaluatorFunction
    //   - notificationDispatcherFunction → used for reminder delivery writes
    //
    // When individual auth / sender Lambdas are broken out in the future,
    // replace the grants below with the per-function handles.

    // API handler acts as the auth service writer for now
    this.auditAuthTable.grantWriteData(computeStack.apiHandlerFunction);

    // NotificationDispatcher writes reminder delivery outcomes
    this.reminderDeliveryTable.grantWriteData(computeStack.notificationDispatcherFunction);

    // MilestoneEvaluator reads audit records and read/writes delivery table
    this.auditAuthTable.grantReadData(computeStack.milestoneEvaluatorFunction);
    this.reminderDeliveryTable.grantReadWriteData(computeStack.milestoneEvaluatorFunction);

    // Grant Lambda functions access to the KMS key for encrypted table operations
    this.dynamoKmsKey.grantEncryptDecrypt(computeStack.apiHandlerFunction);
    this.dynamoKmsKey.grantEncryptDecrypt(computeStack.notificationDispatcherFunction);
    this.dynamoKmsKey.grantEncryptDecrypt(computeStack.milestoneEvaluatorFunction);

    // ── 5. SNS alert topic ────────────────────────────────────────────────────
    // MessagingStack already creates and exports alertsTopic.
    // Re-use it so all ops alarms fan into the same subscription.
    const alertsTopic: sns.ITopic = messagingStack.alertsTopic;
    const alertsAction = new cloudwatchActions.SnsAction(alertsTopic);

    // ── 6. CloudWatch Log Groups (365-day retention) ──────────────────────────
    new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      logGroupName: `/postopcare/api-gateway/${env}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: tableRemovalPolicy,
    });

    new logs.LogGroup(this, 'AuthLogGroup', {
      logGroupName: `/postopcare/auth/${env}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: tableRemovalPolicy,
    });

    new logs.LogGroup(this, 'MilestoneEvaluatorLogGroup', {
      logGroupName: `/postopcare/milestone-evaluator/${env}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: tableRemovalPolicy,
    });

    // ── 7. CloudWatch Alarms ──────────────────────────────────────────────────

    // ── API Gateway: 5XX errors > 10 in 5 min ─────────────────────────────────
    // The HTTP API v2 metric namespace is 'AWS/ApiGateway'.
    // We derive the API ID from the apiEndpointUrl exported by ComputeStack
    // via a CloudFormation Fn::Select on the URL parts, or we use a metric
    // that scopes to the API via dimensions.
    //
    // NOTE: HttpApi (v2) metrics use the 'AWS/ApiGateway' namespace with
    // dimension ApiId. We create a generic namespace metric here.
    // If you need per-ApiId scoping, replace with:
    //   new cloudwatch.Metric({ namespace: 'AWS/ApiGateway', metricName: '5xx', ... })
    const apiGw5xxAlarm = new cloudwatch.Alarm(this, 'ApiGw5xxAlarm', {
      alarmName: `postopcare-apigw-5xx-${env}`,
      alarmDescription: 'API Gateway HTTP 5XX errors exceeded 10 in a 5-minute window',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5xx',
        dimensionsMap: {
          ApiId: cdk.Fn.select(2, cdk.Fn.split('/', computeStack.apiUrl)),
          Stage: '$default',
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiGw5xxAlarm.addAlarmAction(alertsAction);

    // ── API Gateway: 4XX errors > 100 in 5 min ────────────────────────────────
    const apiGw4xxAlarm = new cloudwatch.Alarm(this, 'ApiGw4xxAlarm', {
      alarmName: `postopcare-apigw-4xx-${env}`,
      alarmDescription: 'API Gateway HTTP 4XX errors exceeded 100 in a 5-minute window',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '4xx',
        dimensionsMap: {
          ApiId: cdk.Fn.select(2, cdk.Fn.split('/', computeStack.apiUrl)),
          Stage: '$default',
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 100,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiGw4xxAlarm.addAlarmAction(alertsAction);

    // ── Auth Lambda errors > 5 in 5 min ──────────────────────────────────────
    // apiHandlerFunction handles auth routes; replace with dedicated authFn
    // when the auth Lambda is split out.
    const authLambdaErrorAlarm = new cloudwatch.Alarm(this, 'AuthLambdaErrorAlarm', {
      alarmName: `postopcare-auth-errors-${env}`,
      alarmDescription: 'Auth Lambda (apiHandler) error count exceeded 5 in 5 minutes',
      metric: computeStack.apiHandlerFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
        label: 'Auth Lambda Errors',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    authLambdaErrorAlarm.addAlarmAction(alertsAction);

    // ── MilestoneEvaluator errors > 0 in 5 min (critical) ────────────────────
    const milestoneEvaluatorErrorAlarm = new cloudwatch.Alarm(
      this,
      'MilestoneEvaluatorErrorAlarm',
      {
        alarmName: `postopcare-milestone-evaluator-errors-${env}`,
        alarmDescription: 'CRITICAL: MilestoneEvaluator Lambda encountered any errors in 5 minutes',
        metric: computeStack.milestoneEvaluatorFunction.metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: 'Sum',
          label: 'MilestoneEvaluator Errors',
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );
    milestoneEvaluatorErrorAlarm.addAlarmAction(alertsAction);

    // ── NotificationDispatcher errors > 5 in 5 min ───────────────────────────
    const notificationDispatcherErrorAlarm = new cloudwatch.Alarm(
      this,
      'NotificationDispatcherErrorAlarm',
      {
        alarmName: `postopcare-notification-dispatcher-errors-${env}`,
        alarmDescription: 'NotificationDispatcher Lambda error count exceeded 5 in 5 minutes',
        metric: computeStack.notificationDispatcherFunction.metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: 'Sum',
          label: 'NotificationDispatcher Errors',
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }
    );
    notificationDispatcherErrorAlarm.addAlarmAction(alertsAction);

    // ── SQS DLQ alarms ────────────────────────────────────────────────────────
    // MessagingStack exposes four per-channel FIFO notification queues, each with
    // its own DLQ. Alarm on every channel's DLQ. (Milestones are driven by
    // EventBridge Scheduler, not SQS, so there is no milestone DLQ to alarm.)
    const notificationChannels: Array<{ id: string; slug: string; queue: NotificationQueue }> = [
      { id: 'Inapp', slug: 'inapp', queue: messagingStack.inappQueue },
      { id: 'Email', slug: 'email', queue: messagingStack.emailQueue },
      { id: 'Sms', slug: 'sms', queue: messagingStack.smsQueue },
      { id: 'Whatsapp', slug: 'whatsapp', queue: messagingStack.whatsappQueue },
    ];

    for (const channel of notificationChannels) {
      const dlqAlarm = new cloudwatch.Alarm(this, `${channel.id}DlqAlarm`, {
        alarmName: `postopcare-${channel.slug}-dlq-not-empty-${env}`,
        alarmDescription: `Messages landed in the ${channel.id} notification DLQ — requires investigation`,
        metric: channel.queue.dlq.metricApproximateNumberOfMessagesVisible({
          period: cdk.Duration.minutes(1),
          statistic: 'Maximum',
          label: `${channel.id} DLQ Depth`,
        }),
        threshold: 0,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      dlqAlarm.addAlarmAction(alertsAction);
    }

    // ── 8. CloudWatch Dashboard ───────────────────────────────────────────────
    const dashboard = new cloudwatch.Dashboard(this, 'OperationsDashboard', {
      dashboardName: `postopcare-${env}`,
    });

    // Row 1: API Gateway — request count, 5XX, 4XX
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway — Request Count',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: 'Count',
            dimensionsMap: {
              ApiId: cdk.Fn.select(2, cdk.Fn.split('/', computeStack.apiUrl)),
              Stage: '$default',
            },
            period: cdk.Duration.minutes(1),
            statistic: 'Sum',
            label: 'Requests',
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway — 5XX Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '5xx',
            dimensionsMap: {
              ApiId: cdk.Fn.select(2, cdk.Fn.split('/', computeStack.apiUrl)),
              Stage: '$default',
            },
            period: cdk.Duration.minutes(1),
            statistic: 'Sum',
            label: '5XX Count',
          }),
        ],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway — 4XX Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApiGateway',
            metricName: '4xx',
            dimensionsMap: {
              ApiId: cdk.Fn.select(2, cdk.Fn.split('/', computeStack.apiUrl)),
              Stage: '$default',
            },
            period: cdk.Duration.minutes(1),
            statistic: 'Sum',
            label: '4XX Count',
          }),
        ],
        width: 8,
        height: 6,
      })
    );

    // Row 2: Lambda — Auth (apiHandler) + MilestoneEvaluator
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Auth Lambda (apiHandler) — Invocations & Errors',
        left: [
          computeStack.apiHandlerFunction.metricInvocations({
            period: cdk.Duration.minutes(1),
            statistic: 'Sum',
            label: 'Invocations',
          }),
        ],
        right: [
          computeStack.apiHandlerFunction.metricErrors({
            period: cdk.Duration.minutes(1),
            statistic: 'Sum',
            label: 'Errors',
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'MilestoneEvaluator — Invocations & Errors',
        left: [
          computeStack.milestoneEvaluatorFunction.metricInvocations({
            period: cdk.Duration.minutes(1),
            statistic: 'Sum',
            label: 'Invocations',
          }),
        ],
        right: [
          computeStack.milestoneEvaluatorFunction.metricErrors({
            period: cdk.Duration.minutes(1),
            statistic: 'Sum',
            label: 'Errors',
          }),
        ],
        width: 12,
        height: 6,
      })
    );

    // Row 3: SQS queue depths for the active queues
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'SQS Queue Depths',
        left: notificationChannels.map((channel) =>
          channel.queue.queue.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(1),
            statistic: 'Maximum',
            label: `${channel.id} Queue`,
          })
        ),
        width: 24,
        height: 6,
      })
    );

    // Row 4: DLQ depths
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'SQS DLQ Depths',
        left: notificationChannels.map((channel) =>
          channel.queue.dlq.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(1),
            statistic: 'Maximum',
            label: `${channel.id} DLQ`,
          })
        ),
        right: [],
        width: 24,
        height: 6,
      })
    );

    // ── 9. CloudFormation Outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AuditAuthTableName', {
      value: this.auditAuthTable.tableName,
      exportName: `PostOpCare-AuditAuthTableName-${env}`,
    });

    new cdk.CfnOutput(this, 'AuditAuthTableArn', {
      value: this.auditAuthTable.tableArn,
      exportName: `PostOpCare-AuditAuthTableArn-${env}`,
    });

    new cdk.CfnOutput(this, 'ReminderDeliveryTableName', {
      value: this.reminderDeliveryTable.tableName,
      exportName: `PostOpCare-ReminderDeliveryTableName-${env}`,
    });

    new cdk.CfnOutput(this, 'ReminderDeliveryTableArn', {
      value: this.reminderDeliveryTable.tableArn,
      exportName: `PostOpCare-ReminderDeliveryTableArn-${env}`,
    });

    new cdk.CfnOutput(this, 'DynamoKMSKeyArn', {
      value: this.dynamoKmsKey.keyArn,
      exportName: `PostOpCare-DynamoKMSKeyArn-${env}`,
    });

    new cdk.CfnOutput(this, 'DashboardName', {
      value: `postopcare-${env}`,
      exportName: `PostOpCare-DashboardName-${env}`,
    });
  }
}
