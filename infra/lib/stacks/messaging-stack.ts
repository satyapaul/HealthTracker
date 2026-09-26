import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';
import { NotificationQueue } from '../constructs/notification-queue';

export interface MessagingStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
}

export class MessagingStack extends cdk.Stack {
  /** KMS CMK for all SNS/SQS encryption in this stack */
  public readonly encryptionKey: kms.Key;

  /** Standard SNS topic for ops/infrastructure alerts (DLQ alarms, Lambda errors) */
  public readonly alertsTopic: sns.Topic;

  // ── Per-channel FIFO notification queues ──────────────────────────────────
  /** In-app notification queue (consumed by inappSenderFn) */
  public readonly inappQueue: NotificationQueue;
  /** Email notification queue (consumed by emailSenderFn) */
  public readonly emailQueue: NotificationQueue;
  /** SMS notification queue (consumed by smsSenderFn) */
  public readonly smsQueue: NotificationQueue;
  /** WhatsApp notification queue (consumed by whatsappSenderFn) */
  public readonly whatsappQueue: NotificationQueue;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.env === 'prod';

    // ── 1. KMS CMK ────────────────────────────────────────────────────────────
    // Single key covers all SNS topics and SQS queues in this stack.
    this.encryptionKey = new kms.Key(this, 'MessagingKey', {
      alias: `alias/postopcare-messaging-${config.env}`,
      description: `PostOp Care messaging encryption key (${config.env})`,
      enableKeyRotation: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Allow SNS service principal to use this key so that SNS-encrypted topics
    // can be created and SQS queues subscribed to them can decrypt messages.
    this.encryptionKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSNSKmsUsage',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('sns.amazonaws.com')],
        actions: ['kms:GenerateDataKey*', 'kms:Decrypt'],
        resources: ['*'],
      })
    );

    // Also allow SQS service to use the key (needed for encrypted FIFO queues
    // that receive from SNS fanout, or are polled by Lambda event sources).
    this.encryptionKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSQSKmsUsage',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('sqs.amazonaws.com')],
        actions: ['kms:GenerateDataKey*', 'kms:Decrypt'],
        resources: ['*'],
      })
    );

    // ── 2. Alerts SNS Topic (standard, not FIFO) ──────────────────────────────
    // Receives CloudWatch alarm notifications. Subscribed by ops email.
    this.alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: `postopcare-alerts-${config.env}`,
      displayName: 'PostOpCare Operations Alerts',
      masterKey: this.encryptionKey,
    });

    this.alertsTopic.addSubscription(new snsSubscriptions.EmailSubscription(config.alertEmail));

    // ── 3. Per-channel FIFO notification queues ───────────────────────────────
    // Each channel has its own queue + DLQ so that a downstream provider outage
    // (e.g. SMS gateway down) does not back-pressure email delivery.

    this.inappQueue = new NotificationQueue(this, 'InappQueue', {
      queueName: `postopcare-inapp-${config.env}`,
      encryptionKey: this.encryptionKey,
      messageRetentionPeriod: cdk.Duration.days(1),
      visibilityTimeout: cdk.Duration.seconds(60),
      alarmTopic: this.alertsTopic,
    });

    this.emailQueue = new NotificationQueue(this, 'EmailQueue', {
      queueName: `postopcare-email-${config.env}`,
      encryptionKey: this.encryptionKey,
      messageRetentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.seconds(60),
      alarmTopic: this.alertsTopic,
    });

    this.smsQueue = new NotificationQueue(this, 'SmsQueue', {
      queueName: `postopcare-sms-${config.env}`,
      encryptionKey: this.encryptionKey,
      messageRetentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.seconds(60),
      alarmTopic: this.alertsTopic,
    });

    this.whatsappQueue = new NotificationQueue(this, 'WhatsappQueue', {
      queueName: `postopcare-whatsapp-${config.env}`,
      encryptionKey: this.encryptionKey,
      messageRetentionPeriod: cdk.Duration.days(4),
      visibilityTimeout: cdk.Duration.seconds(60),
      alarmTopic: this.alertsTopic,
    });

    // ── 4. EventBridge Scheduler IAM role ─────────────────────────────────────
    // NOTE: The EventBridge Scheduler role AND the CfnSchedule resources are
    // both created in ComputeStack (it owns the MilestoneEvaluator Lambda whose
    // ARN the role must reference). Defining the role here previously forced
    // ComputeStack to mutate a Messaging-owned role with a Compute ARN, creating
    // a cross-stack dependency cycle — so it now lives entirely in ComputeStack.

    // ── 5. CloudFormation Outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'InappQueueUrl', {
      value: this.inappQueue.queue.queueUrl,
      exportName: `PostOpCare-InappQueueUrl-${config.env}`,
      description: 'In-app notification FIFO queue URL',
    });

    new cdk.CfnOutput(this, 'InappDlqArn', {
      value: this.inappQueue.dlq.queueArn,
      exportName: `PostOpCare-InappDlqArn-${config.env}`,
      description: 'In-app notification DLQ ARN',
    });

    new cdk.CfnOutput(this, 'EmailQueueUrl', {
      value: this.emailQueue.queue.queueUrl,
      exportName: `PostOpCare-EmailQueueUrl-${config.env}`,
      description: 'Email notification FIFO queue URL',
    });

    new cdk.CfnOutput(this, 'EmailDlqArn', {
      value: this.emailQueue.dlq.queueArn,
      exportName: `PostOpCare-EmailDlqArn-${config.env}`,
      description: 'Email notification DLQ ARN',
    });

    new cdk.CfnOutput(this, 'SmsQueueUrl', {
      value: this.smsQueue.queue.queueUrl,
      exportName: `PostOpCare-SmsQueueUrl-${config.env}`,
      description: 'SMS notification FIFO queue URL',
    });

    new cdk.CfnOutput(this, 'SmsDlqArn', {
      value: this.smsQueue.dlq.queueArn,
      exportName: `PostOpCare-SmsDlqArn-${config.env}`,
      description: 'SMS notification DLQ ARN',
    });

    new cdk.CfnOutput(this, 'WhatsappQueueUrl', {
      value: this.whatsappQueue.queue.queueUrl,
      exportName: `PostOpCare-WhatsappQueueUrl-${config.env}`,
      description: 'WhatsApp notification FIFO queue URL',
    });

    new cdk.CfnOutput(this, 'WhatsappDlqArn', {
      value: this.whatsappQueue.dlq.queueArn,
      exportName: `PostOpCare-WhatsappDlqArn-${config.env}`,
      description: 'WhatsApp notification DLQ ARN',
    });

    new cdk.CfnOutput(this, 'MessagingKMSKeyArn', {
      value: this.encryptionKey.keyArn,
      exportName: `PostOpCare-MessagingKMSKeyArn-${config.env}`,
      description: 'KMS key ARN used for messaging stack encryption',
    });

    new cdk.CfnOutput(this, 'AlertsTopicArn', {
      value: this.alertsTopic.topicArn,
      exportName: `PostOpCare-AlertsTopicArn-${config.env}`,
      description: 'Ops alerts SNS topic ARN',
    });
  }
}
