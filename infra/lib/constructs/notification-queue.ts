import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cdk from 'aws-cdk-lib';

export interface NotificationQueueProps {
  queueName: string;
  encryptionKey: kms.IKey;
  messageRetentionPeriod: cdk.Duration;
  visibilityTimeout: cdk.Duration;
  alarmTopic?: sns.ITopic;
}

export class NotificationQueue extends Construct {
  public readonly queue: sqs.Queue;
  public readonly dlq: sqs.Queue;
  public readonly dlqAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: NotificationQueueProps) {
    super(scope, id);

    // Dead-letter queue
    this.dlq = new sqs.Queue(this, 'DLQ', {
      queueName: `${props.queueName}-dlq.fifo`,
      fifo: true,
      retentionPeriod: cdk.Duration.days(7),
      encryptionMasterKey: props.encryptionKey,
    });

    // Main FIFO queue
    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: `${props.queueName}.fifo`,
      fifo: true,
      contentBasedDeduplication: false,
      retentionPeriod: props.messageRetentionPeriod,
      visibilityTimeout: props.visibilityTimeout,
      encryptionMasterKey: props.encryptionKey,
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3,
      },
    });

    // Alarm on DLQ depth
    this.dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: `${props.queueName}-dlq-not-empty`,
      alarmDescription: `Messages in DLQ for ${props.queueName} - requires investigation`,
      metric: this.dlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    if (props.alarmTopic) {
      this.dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(props.alarmTopic));
    }
  }
}
