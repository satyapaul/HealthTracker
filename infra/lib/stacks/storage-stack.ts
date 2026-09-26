import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';

export interface StorageStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
}

export class StorageStack extends cdk.Stack {
  public readonly labReportsBucket: s3.Bucket;
  public readonly exportsBucket: s3.Bucket;
  public readonly assetsBucket: s3.Bucket;
  public readonly encryptionKey: kms.Key;
  public readonly virusScanTopic: sns.Topic;
  /**
   * CloudFront Origin Access Identity for the assets bucket. Created and granted
   * read/decrypt HERE (in the Storage stack) so all assets-bucket and KMS-key
   * policy mutations stay within this stack. EdgeStack consumes this OAI for its
   * CloudFront S3 origin — a one-way Edge -> Storage reference that avoids the
   * cross-region/cross-stack dependency cycle a `grantRead` from EdgeStack caused.
   */
  public readonly assetsOai: cloudfront.OriginAccessIdentity;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.env === 'prod';

    // ── KMS CMK for S3 ────────────────────────────────────────────────────────
    this.encryptionKey = new kms.Key(this, 'S3Key', {
      alias: `alias/postopcare-s3-${config.env}`,
      description: 'PostOp Care S3 buckets encryption key (PHI)',
      enableKeyRotation: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ── SNS Topic for virus scan events ───────────────────────────────────────
    // S3 publishes ObjectCreated events here → virus-scan Lambda subscribes.
    // KMS key allows SNS to decrypt/encrypt messages.
    this.virusScanTopic = new sns.Topic(this, 'VirusScanTopic', {
      topicName: `postopcare-virus-scan-${config.env}`,
      displayName: 'PostOp Care Lab Report Virus Scan',
      masterKey: this.encryptionKey,
    });

    // Allow S3 service to publish to this topic
    this.virusScanTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowS3Publish',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('s3.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.virusScanTopic.topicArn],
        conditions: {
          ArnLike: {
            'aws:SourceArn': `arn:aws:s3:::postopcare-lab-reports-${cdk.Aws.ACCOUNT_ID}-${config.env}`,
          },
        },
      })
    );
    // Also allow KMS usage for SNS when called from S3
    this.encryptionKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSNSKmsUsage',
        principals: [new iam.ServicePrincipal('sns.amazonaws.com')],
        actions: ['kms:GenerateDataKey*', 'kms:Decrypt'],
        resources: ['*'],
      })
    );

    // ── Lab Reports bucket ────────────────────────────────────────────────────
    // Stores patient-uploaded lab PDFs and images. PHI bucket.
    // 7-year retention for medical records compliance.
    this.labReportsBucket = new s3.Bucket(this, 'LabReportsBucket', {
      bucketName: `postopcare-lab-reports-${cdk.Aws.ACCOUNT_ID}-${config.env}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: [`https://${config.domainName}`, `https://www.${config.domainName}`],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'medical-records-lifecycle',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(365),
            },
          ],
          // Medical records: 7 years (2555 days)
          expiration: cdk.Duration.days(2555),
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // S3 → SNS notification for virus scanning on every new object
    this.labReportsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(this.virusScanTopic)
    );

    // ── Exports bucket ────────────────────────────────────────────────────────
    // Stores generated PDF chart exports. Short TTL — presigned URL valid 24h,
    // object auto-deleted after 1 day.
    this.exportsBucket = new s3.Bucket(this, 'ExportsBucket', {
      bucketName: `postopcare-exports-${cdk.Aws.ACCOUNT_ID}-${config.env}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      lifecycleRules: [
        {
          id: 'exports-ttl',
          enabled: true,
          expiration: cdk.Duration.days(1),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── Assets bucket ─────────────────────────────────────────────────────────
    // Stores patient profile photos and static app assets.
    // Accessed via CloudFront with Origin Access Control (OAC).
    // NOTE: The CloudFront OAC bucket policy granting CloudFront read access
    // is added by EdgeStack after CloudFront distribution is created.
    this.assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
      bucketName: `postopcare-assets-${cdk.Aws.ACCOUNT_ID}-${config.env}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // ── CloudFront OAI for the assets bucket (owned here) ─────────────────────
    // Created in the Storage stack (not EdgeStack) so the read/decrypt grants
    // mutate this stack's bucket + KMS key policies only. EdgeStack consumes
    // `assetsOai` for its S3 origin, keeping the dependency one-way (Edge -> Storage).
    this.assetsOai = new cloudfront.OriginAccessIdentity(this, 'AssetsOai', {
      comment: `OAI for PostOp Care assets bucket (${config.env})`,
    });
    this.assetsBucket.grantRead(this.assetsOai);
    this.encryptionKey.grantDecrypt(this.assetsOai);

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'LabReportsBucketName', {
      value: this.labReportsBucket.bucketName,
      exportName: `PostOpCare-LabReportsBucketName-${config.env}`,
    });
    new cdk.CfnOutput(this, 'LabReportsBucketArn', {
      value: this.labReportsBucket.bucketArn,
      exportName: `PostOpCare-LabReportsBucketArn-${config.env}`,
    });
    new cdk.CfnOutput(this, 'ExportsBucketName', {
      value: this.exportsBucket.bucketName,
      exportName: `PostOpCare-ExportsBucketName-${config.env}`,
    });
    new cdk.CfnOutput(this, 'AssetsBucketName', {
      value: this.assetsBucket.bucketName,
      exportName: `PostOpCare-AssetsBucketName-${config.env}`,
    });
    new cdk.CfnOutput(this, 'AssetsBucketArn', {
      value: this.assetsBucket.bucketArn,
      exportName: `PostOpCare-AssetsBucketArn-${config.env}`,
    });
    new cdk.CfnOutput(this, 'S3KMSKeyArn', {
      value: this.encryptionKey.keyArn,
      exportName: `PostOpCare-S3KMSKeyArn-${config.env}`,
    });
    new cdk.CfnOutput(this, 'VirusScanTopicArn', {
      value: this.virusScanTopic.topicArn,
      exportName: `PostOpCare-VirusScanTopicArn-${config.env}`,
    });
  }
}
