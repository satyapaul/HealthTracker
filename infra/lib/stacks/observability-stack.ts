import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';
import { ComputeStack } from './compute-stack';
import { MessagingStack } from './messaging-stack';
import { NotificationQueue } from '../constructs/notification-queue';

// ─────────────────────────────────────────────────────────────────────────────
// ObservabilityStack
// CloudWatch log groups, alarms, SNS alarm actions, and the ops dashboard.
//
// Created AFTER ComputeStack + MessagingStack (it reads their Lambda metrics,
// API URL, SQS queues, and alerts topic). The DynamoDB tables + KMS live in the
// separate DataStack (created before Compute); splitting observability out of
// the old DataOpsStack is what breaks the DataOps↔Compute synth cycle.
//
// Dependencies:
//   - ComputeStack   → Lambda metrics + API URL for alarms/dashboard
//   - MessagingStack → alertsTopic for alarm actions, per-channel DLQ metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface ObservabilityStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
  computeStack: ComputeStack;
  messagingStack: MessagingStack;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { config, computeStack, messagingStack } = props;
    const env = config.env;
    const isProd = env === 'prod';
    const logRemovalPolicy = isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY;

    // ── Compute values via explicit named exports (NOT live token refs) ───────
    // Consuming computeStack.apiUrl / computeStack.*Function directly forces CDK
    // to mint auto-generated `PostOpCare-Compute-dev:ExportsOutput*` exports on
    // the Compute template. Those self-prefixed exports trip CloudFormation's
    // early-validation ResourceExistenceCheck on the Compute changeset. Instead
    // we import the stable, hand-named exports ComputeStack already publishes
    // (ApiUrl + per-function ARNs) via Fn::ImportValue. The import lands only on
    // THIS (Observability) template; Compute keeps just its own clean outputs.
    void computeStack; // dependency retained in app.ts via addDependency()
    const apiUrl = cdk.Fn.importValue(`PostOpCare-ApiUrl-${env}`);
    // The API id is the 3rd '/'-delimited segment of the endpoint URL
    // (https://<apiId>.execute-api.<region>.amazonaws.com). Same derivation as
    // before — behavior unchanged.
    const apiId = cdk.Fn.select(2, cdk.Fn.split('/', apiUrl));

    // Lambda metric dimensions use the function NAME. The last ':'-delimited
    // segment of a function ARN is its name
    // (arn:aws:lambda:<region>:<acct>:function:<name>), so derive it from each
    // imported ARN. This reproduces the exact AWS/Lambda FunctionName dimension
    // the previous `fn.metricErrors()` calls emitted, without a live cross-stack
    // token (which is what minted the Compute self-exports).
    const fnNameFromArn = (arn: string): string => cdk.Fn.select(6, cdk.Fn.split(':', arn));
    const authFnName = fnNameFromArn(cdk.Fn.importValue(`PostOpCare-AuthFnArn-${env}`));
    const milestoneEvaluatorFnName = fnNameFromArn(
      cdk.Fn.importValue(`PostOpCare-MilestoneEvaluatorFnArn-${env}`)
    );
    const notificationDispatcherFnName = fnNameFromArn(
      cdk.Fn.importValue(`PostOpCare-NotificationDispatcherFnArn-${env}`)
    );

    // Helper: build an AWS/Lambda metric for a given function name + metric name.
    const lambdaMetric = (
      functionName: string,
      metricName: 'Errors' | 'Invocations',
      props2: { period: cdk.Duration; label: string }
    ): cloudwatch.Metric =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName,
        dimensionsMap: { FunctionName: functionName },
        period: props2.period,
        statistic: 'Sum',
        label: props2.label,
      });

    // ── 1. SNS alarm action ───────────────────────────────────────────────────
    // MessagingStack already creates and exports alertsTopic.
    // Re-use it so all ops alarms fan into the same subscription.
    const alertsTopic: sns.ITopic = messagingStack.alertsTopic;
    const alertsAction = new cloudwatchActions.SnsAction(alertsTopic);

    // ── 2. CloudWatch Log Groups (365-day retention) ──────────────────────────
    new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      logGroupName: `/postopcare/api-gateway/${env}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: logRemovalPolicy,
    });

    new logs.LogGroup(this, 'AuthLogGroup', {
      logGroupName: `/postopcare/auth/${env}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: logRemovalPolicy,
    });

    new logs.LogGroup(this, 'MilestoneEvaluatorLogGroup', {
      logGroupName: `/postopcare/milestone-evaluator/${env}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: logRemovalPolicy,
    });

    // ── 3. CloudWatch Alarms ──────────────────────────────────────────────────

    // ── API Gateway: 5XX errors > 10 in 5 min ─────────────────────────────────
    const apiGw5xxAlarm = new cloudwatch.Alarm(this, 'ApiGw5xxAlarm', {
      alarmName: `postopcare-apigw-5xx-${env}`,
      alarmDescription: 'API Gateway HTTP 5XX errors exceeded 10 in a 5-minute window',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '5xx',
        dimensionsMap: {
          ApiId: apiId,
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
          ApiId: apiId,
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
    const authLambdaErrorAlarm = new cloudwatch.Alarm(this, 'AuthLambdaErrorAlarm', {
      alarmName: `postopcare-auth-errors-${env}`,
      alarmDescription: 'Auth Lambda (apiHandler) error count exceeded 5 in 5 minutes',
      metric: lambdaMetric(authFnName, 'Errors', {
        period: cdk.Duration.minutes(5),
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
        metric: lambdaMetric(milestoneEvaluatorFnName, 'Errors', {
          period: cdk.Duration.minutes(5),
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
        metric: lambdaMetric(notificationDispatcherFnName, 'Errors', {
          period: cdk.Duration.minutes(5),
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
    // Four per-channel FIFO notification queues, each with its own DLQ.
    const notificationChannels: Array<{ id: string; slug: string; queue: NotificationQueue }> = [
      { id: 'Inapp', slug: 'inapp', queue: messagingStack.inappQueue },
      { id: 'Email', slug: 'email', queue: messagingStack.emailQueue },
      { id: 'Sms', slug: 'sms', queue: messagingStack.smsQueue },
      { id: 'Whatsapp', slug: 'whatsapp', queue: messagingStack.whatsappQueue },
    ];

    for (const channel of notificationChannels) {
      const dlqAlarm = new cloudwatch.Alarm(this, `${channel.id}DlqAlarm`, {
        alarmName: `postopcare-${channel.slug}-dlq-not-empty-${env}`,
        alarmDescription: `Messages landed in the ${channel.id} notification DLQ - requires investigation`,
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

    // ── 4. CloudWatch Dashboard ───────────────────────────────────────────────
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
              ApiId: apiId,
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
              ApiId: apiId,
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
              ApiId: apiId,
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
          lambdaMetric(authFnName, 'Invocations', {
            period: cdk.Duration.minutes(1),
            label: 'Invocations',
          }),
        ],
        right: [
          lambdaMetric(authFnName, 'Errors', {
            period: cdk.Duration.minutes(1),
            label: 'Errors',
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'MilestoneEvaluator — Invocations & Errors',
        left: [
          lambdaMetric(milestoneEvaluatorFnName, 'Invocations', {
            period: cdk.Duration.minutes(1),
            label: 'Invocations',
          }),
        ],
        right: [
          lambdaMetric(milestoneEvaluatorFnName, 'Errors', {
            period: cdk.Duration.minutes(1),
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

    // ── 5. CloudFormation Outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DashboardName', {
      value: `postopcare-${env}`,
      exportName: `PostOpCare-DashboardName-${env}`,
    });
  }
}
