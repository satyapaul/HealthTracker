import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';
import { NetworkingStack } from './networking-stack';

export interface RedisStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
  networkingStack: NetworkingStack;
}

export class RedisStack extends cdk.Stack {
  public readonly cache: elasticache.CfnServerlessCache;
  public readonly encryptionKey: kms.Key;
  // Resolved at synth time via Token; use endpointAddress in Lambda env vars
  public readonly endpointAddress: string;
  public readonly endpointPort: string;

  constructor(scope: Construct, id: string, props: RedisStackProps) {
    super(scope, id, props);

    const { config, networkingStack } = props;
    const isProd = config.env === 'prod';

    // ── KMS CMK for Redis ─────────────────────────────────────────────────────
    this.encryptionKey = new kms.Key(this, 'RedisKey', {
      alias: `alias/postopcare-redis-${config.env}`,
      description: 'PostOp Care ElastiCache Redis encryption key',
      enableKeyRotation: true,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // ── ElastiCache Serverless Cache ──────────────────────────────────────────
    // Using CfnServerlessCache (L1) because CDK L2 does not yet have a
    // high-level construct for ElastiCache Serverless.
    // Serverless scales automatically; no node type to manage.
    // Stores: JWT session tokens, OTP hashes (5-min TTL), rate-limit counters,
    // WebSocket connectionIds, API response cache.
    this.cache = new elasticache.CfnServerlessCache(this, 'RedisServerlessCache', {
      serverlessCacheName: `postopcare-redis-${config.env}`,
      engine: 'redis',
      majorEngineVersion: '7',
      description: `PostOp Care session cache and rate-limit store (${config.env})`,
      // Data storage limit: 5 GB. Enough for thousands of concurrent sessions.
      cacheUsageLimits: {
        dataStorage: {
          maximum: 5,
          unit: 'GB',
        },
        ecpuPerSecond: {
          maximum: 5000,
        },
      },
      securityGroupIds: [networkingStack.redisSG.securityGroupId],
      subnetIds: networkingStack.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }).subnetIds,
      kmsKeyId: this.encryptionKey.keyArn,
      // Daily snapshot at 02:00 UTC (07:30 IST)
      snapshotRetentionLimit: 7,
      dailySnapshotTime: '02:00',
    });

    // Resolved tokens — actual values injected by CloudFormation at deploy time
    this.endpointAddress = this.cache.attrEndpointAddress;
    this.endpointPort = this.cache.attrEndpointPort;

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'RedisEndpointAddress', {
      value: this.endpointAddress,
      exportName: `PostOpCare-RedisEndpointAddress-${config.env}`,
    });
    new cdk.CfnOutput(this, 'RedisEndpointPort', {
      value: this.endpointPort,
      exportName: `PostOpCare-RedisEndpointPort-${config.env}`,
    });
    new cdk.CfnOutput(this, 'RedisKMSKeyArn', {
      value: this.encryptionKey.keyArn,
      exportName: `PostOpCare-RedisKMSKeyArn-${config.env}`,
    });
  }
}
