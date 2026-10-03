import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { PostOpCareConfig } from '../types';

export interface NetworkingStackProps extends cdk.StackProps {
  config: PostOpCareConfig;
}

export class NetworkingStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly lambdaSG: ec2.SecurityGroup;
  public readonly redisSG: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.env === 'prod';

    // ── VPC ───────────────────────────────────────────────────────────────────
    // Single NAT Gateway for clinic-scale (dev/staging). Use 2 for prod HA.
    // Tradeoff: with 1 NAT GW, loss of NAT GW AZ causes Lambda outbound outage
    // in that AZ. Acceptable for this workload given cost constraints.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `postopcare-vpc-${config.env}`,
      maxAzs: 2,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      natGateways: isProd ? 2 : 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // ── VPC Flow Logs ─────────────────────────────────────────────────────────
    const flowLogGroup = new logs.LogGroup(this, 'VpcFlowLogGroup', {
      logGroupName: `/postopcare/vpc-flow-logs/${config.env}`,
      retention: logs.RetentionDays.ONE_YEAR,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // ── Security Groups ───────────────────────────────────────────────────────
    // Lambda SG: Lambdas initiate connections outbound; no inbound rules needed.
    this.lambdaSG = new ec2.SecurityGroup(this, 'LambdaSG', {
      vpc: this.vpc,
      securityGroupName: `postopcare-lambda-sg-${config.env}`,
      description: 'PostOp Care Lambda functions - outbound only',
      allowAllOutbound: true,
    });

    // RDS SG is owned by the Database stack (see database-stack.ts) so CDK's
    // connections wiring does not mutate a Networking-owned SG with the Aurora
    // cluster's port token — that reverse edge caused a synth dependency cycle.

    // Redis SG: Only accept Redis from Lambda SG.
    this.redisSG = new ec2.SecurityGroup(this, 'RedisSG', {
      vpc: this.vpc,
      securityGroupName: `postopcare-redis-sg-${config.env}`,
      description: 'PostOp Care ElastiCache Redis - Lambda access only',
      allowAllOutbound: false,
    });
    this.redisSG.addIngressRule(
      this.lambdaSG,
      ec2.Port.tcp(6379),
      'Allow Lambda to connect to ElastiCache Redis'
    );

    // ── VPC Gateway Endpoints (free — keep S3/DynamoDB traffic off NAT GW) ───
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    this.vpc.addGatewayEndpoint('DynamoDBEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // ── VPC Interface Endpoints ───────────────────────────────────────────────
    // Secrets Manager: Lambdas in private subnets fetch secrets without NAT
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      securityGroups: [this.lambdaSG],
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // SQS: notification dispatch from Lambda without NAT
    this.vpc.addInterfaceEndpoint('SqsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SQS,
      securityGroups: [this.lambdaSG],
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      exportName: `PostOpCare-VpcId-${config.env}`,
    });
    new cdk.CfnOutput(this, 'LambdaSGId', {
      value: this.lambdaSG.securityGroupId,
      exportName: `PostOpCare-LambdaSGId-${config.env}`,
    });
    new cdk.CfnOutput(this, 'RedisSGId', {
      value: this.redisSG.securityGroupId,
      exportName: `PostOpCare-RedisSGId-${config.env}`,
    });
  }
}
