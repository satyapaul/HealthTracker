import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface PostOpCareLambdaProps {
  /**
   * Logical Lambda name. Used to build the physical function name
   * (`postopcare-<functionName>-<env>`) and, unless `sourceDir` is given, to
   * resolve the source folder under apps/api/functions/. Must be unique within
   * the stack — two functions sharing a physical name fails CloudFormation's
   * early validation (resource name conflict).
   */
  functionName: string;
  /**
   * Source folder under apps/api/functions/ to bundle from. Defaults to
   * `functionName`. Set this when two functions share one source domain but
   * need distinct physical names (e.g. the auth handler and its authorizer).
   */
  sourceDir?: string;
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
      props.sourceDir ?? props.functionName,
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
