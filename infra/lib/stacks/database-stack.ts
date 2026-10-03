import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';
import { NetworkingStack } from './networking-stack';

export interface DatabaseStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
  networkingStack: NetworkingStack;
}

export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly proxy: rds.DatabaseProxy;
  public readonly encryptionKey: kms.Key;
  public readonly rdsSG: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, networkingStack } = props;
    const isProd = config.env === 'prod';

    // ── RDS Security Group (owned by this stack) ──────────────────────────────
    // Owned here (not in Networking) so CDK's connections wiring never mutates a
    // cross-stack SG with a port token from this cluster — that reverse edge
    // (Networking -> Database endpoint port) is what created the synth cycle.
    // Ingress is a STATIC 5432 from the Lambda SG; referencing networkingStack.lambdaSG
    // is a one-way Database -> Networking dependency, which is allowed.
    this.rdsSG = new ec2.SecurityGroup(this, 'RdsSG', {
      vpc: networkingStack.vpc,
      securityGroupName: `postopcare-rds-sg-${config.env}`,
      description: 'PostOp Care Aurora PostgreSQL - Lambda access only',
      allowAllOutbound: false,
    });
    this.rdsSG.addIngressRule(
      networkingStack.lambdaSG,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to Aurora PostgreSQL'
    );

    // ── KMS CMK for Aurora ────────────────────────────────────────────────────
    this.encryptionKey = new kms.Key(this, 'AuroraKey', {
      alias: `alias/postopcare-aurora-${config.env}`,
      description: 'PostOp Care Aurora PostgreSQL encryption key',
      enableKeyRotation: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ── Aurora PostgreSQL Serverless v2 ───────────────────────────────────────
    // Serverless v2: scales ACU 0.5 → 16 (dev) or 0.5 → 64 (prod).
    // Scale-from-zero: minimum 0.5 ACU (never completely cold) avoids ~1-2s
    // connection delays on first request.
    this.cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      clusterIdentifier: `postopcare-aurora-${config.env}`,
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_3,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('postopcare_master', {
        secretName: `postopcare/db/master/${config.env}`,
        encryptionKey: this.encryptionKey,
      }),
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: isProd ? 64 : 16,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        autoMinorVersionUpgrade: true,
        enablePerformanceInsights: isProd,
        performanceInsightEncryptionKey: isProd ? this.encryptionKey : undefined,
      }),
      readers: isProd
        ? [
            rds.ClusterInstance.serverlessV2('Reader', {
              scaleWithWriter: true,
              autoMinorVersionUpgrade: true,
            }),
          ]
        : [],
      vpc: networkingStack.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.rdsSG],
      defaultDatabaseName: 'postopcare',
      storageEncrypted: true,
      storageEncryptionKey: this.encryptionKey,
      backup: {
        retention: isProd ? cdk.Duration.days(35) : cdk.Duration.days(7),
        preferredWindow: '01:00-02:00',
      },
      preferredMaintenanceWindow: 'sun:02:00-sun:03:00',
      deletionProtection: isProd,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_YEAR,
      iamAuthentication: false, // Using Secrets Manager auth via RDS Proxy
      parameterGroup: new rds.ParameterGroup(this, 'ClusterParamGroup', {
        engine: rds.DatabaseClusterEngine.auroraPostgres({
          version: rds.AuroraPostgresEngineVersion.VER_16_3,
        }),
        description: `PostOp Care Aurora parameter group (${config.env})`,
        parameters: {
          // Store timestamps in UTC; Lambda converts to IST for display
          timezone: 'UTC',
          // Enable query logging in non-prod for development
          log_statement: isProd ? 'none' : 'ddl',
          log_min_duration_statement: isProd ? '-1' : '1000',
          // Connection pooling friendly settings
          idle_in_transaction_session_timeout: '30000',
        },
      }),
    });

    // ── RDS Proxy ─────────────────────────────────────────────────────────────
    // Lambda functions have bursty concurrency. RDS Proxy pools DB connections
    // so Aurora is not overwhelmed during spikes (e.g., milestone scheduler fan-out).
    this.proxy = new rds.DatabaseProxy(this, 'RdsProxy', {
      dbProxyName: `postopcare-proxy-${config.env}`,
      proxyTarget: rds.ProxyTarget.fromCluster(this.cluster),
      secrets: [this.cluster.secret!],
      vpc: networkingStack.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.rdsSG],
      requireTLS: true,
      idleClientTimeout: cdk.Duration.minutes(30),
      maxConnectionsPercent: 90,
      iamAuth: false,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      exportName: `PostOpCare-ClusterEndpoint-${config.env}`,
    });
    new cdk.CfnOutput(this, 'ProxyEndpoint', {
      value: this.proxy.endpoint,
      exportName: `PostOpCare-ProxyEndpoint-${config.env}`,
    });
    new cdk.CfnOutput(this, 'DBSecretArn', {
      value: this.cluster.secret!.secretArn,
      exportName: `PostOpCare-DBSecretArn-${config.env}`,
    });
    new cdk.CfnOutput(this, 'AuroraKMSKeyArn', {
      value: this.encryptionKey.keyArn,
      exportName: `PostOpCare-AuroraKMSKeyArn-${config.env}`,
    });
    new cdk.CfnOutput(this, 'RDSSGId', {
      value: this.rdsSG.securityGroupId,
      exportName: `PostOpCare-RDSSGId-${config.env}`,
    });
  }
}
