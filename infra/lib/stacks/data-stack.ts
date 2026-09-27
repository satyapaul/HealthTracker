import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// DataStack
// Provisions the DynamoDB tables and their KMS CMK for the PostOp Care platform.
//
// This stack owns ONLY data resources. It has no dependency on ComputeStack or
// MessagingStack — the IAM grants that wire the compute Lambdas to these tables
// live in ComputeStack (Compute → Data edge), so the previous DataOps ↔ Compute
// synth cycle is broken.
// ─────────────────────────────────────────────────────────────────────────────

export interface DataStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
}

export class DataStack extends cdk.Stack {
  /** DynamoDB table for authentication audit events */
  public readonly auditAuthTable: dynamodb.Table;
  /** DynamoDB table for reminder delivery tracking */
  public readonly reminderDeliveryTable: dynamodb.Table;
  /** KMS CMK used to encrypt the DynamoDB tables */
  public readonly dynamoKmsKey: kms.Key;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { config } = props;
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

    // ── 4. CloudFormation Outputs ─────────────────────────────────────────────
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
  }
}
