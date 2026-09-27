import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface PostOpCareLambdaProps {
  /** Lambda function name (also used to resolve source path under apps/api/functions/) */
  functionName: string;
  description: string;
  /** Handler export name. Default: handler */
  handler?: string;
  /** Source entry file within the function folder. Default: index.ts */
  entryFile?: string;
  memorySize: number;
  timeout: cdk.Duration;
  environment: Record<string, string>;
  vpc?: ec2.IVpc;
  vpcSubnets?: ec2.SubnetSelection;
  securityGroups?: ec2.ISecurityGroup[];
  layers?: lambda.ILayerVersion[];
  reservedConcurrentExecutions?: number;
}

export class PostOpCareLambda extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: PostOpCareLambdaProps) {
    super(scope, id);

    const entry = path.join(
      __dirname,
      '../../../apps/api/functions',
      props.functionName,
      props.entryFile ?? 'index.ts'
    );

    const nodeJsProps: NodejsFunctionProps = {
      functionName: `postopcare-${props.functionName}-${cdk.Stack.of(this).stackName.split('-').pop()}`,
      description: props.description,
      handler: props.handler ?? 'handler',
      runtime: lambda.Runtime.NODEJS_LATEST,
      entry,
      memorySize: props.memorySize,
      timeout: props.timeout,
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_YEAR,
      bundling: {
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        externalModules: ['@aws-sdk/*'],
        esbuildArgs: { '--tree-shaking': 'true' },
      },
      environment: {
        LOG_LEVEL: 'info',
        NODE_OPTIONS: '--enable-source-maps',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        ...props.environment,
      },
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      securityGroups: props.securityGroups,
      layers: props.layers,
      reservedConcurrentExecutions: props.reservedConcurrentExecutions,
    };

    this.function = new NodejsFunction(this, 'Function', nodeJsProps);
  }

  public addToRolePolicy(statement: iam.PolicyStatement): void {
    this.function.addToRolePolicy(statement);
  }

  public grantInvoke(grantee: iam.IGrantable): iam.Grant {
    return this.function.grantInvoke(grantee);
  }
}
